import { RPC_URL, TOKEN0_ADDRESS, TOKEN1_ADDRESS, WALLET_ADDRESS, WALLET_KEY } from '../utils';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { Web3 } from 'web3';
import { PositionManager } from '../../src/positions/position-manager';
import { UniswapPool } from '../../src/pool/uniswap-pool';
import { FeeAmount } from '@uniswap/v3-sdk';
import { transactionMining } from '../utils/web3';
import { Fraction } from '@uniswap/sdk-core';
import { ERC20Facade } from '../../src/erc20';
import { UniswapConfig, uniswapConfigByChainId } from '../../src/config';

describe('Position manager tests', () => {
  const web3 = new Web3(RPC_URL);
  web3.registerPlugin(new MulticallPlugin());

  let positionManager: PositionManager;
  let uniswapPool: UniswapPool;
  let erc20Facade: ERC20Facade;
  let config: UniswapConfig;

  beforeAll(async () => {
    positionManager = await PositionManager.create(RPC_URL);
    uniswapPool = await UniswapPool.fromTokens(RPC_URL, {
      token1Address: TOKEN0_ADDRESS,
      token2Address: TOKEN1_ADDRESS,
      fee: FeeAmount.MEDIUM,
    });
    erc20Facade = new ERC20Facade(RPC_URL);
    const chainId = await web3.eth.getChainId();
    config = uniswapConfigByChainId[Number(chainId)];
  });

  it('Should increase liquidity', async () => {
    const position = await getSamplePosition();

    const increaseLiquidityTransaction = await positionManager.increaseLiquidity(position, new Fraction(50, 100));

    const increaseLiquidityTransactionReceipt = await increaseLiquidityTransaction.execute({
      privateKey: WALLET_KEY,
      rpcUrl: RPC_URL,
    });

    await transactionMining(RPC_URL, increaseLiquidityTransactionReceipt.transactionHash.toString());

    const increasedPosition = await positionManager.getPositionByTokenId(position.tokenId);

    console.log(position.liquidity);
    console.log(increasedPosition.liquidity);

    expect(increasedPosition.liquidity).toBeGreaterThan(position.liquidity);
  });

  it('Should ensure allowance when increasing liquidity', async () => {
    const position = await getSamplePosition();
    const approve0 = await erc20Facade.approve(
      position.token0,
      config.deploymentAddresses.nonFungiblePositionManager,
      0n,
    );
    const approve1 = await erc20Facade.approve(
      position.token1,
      config.deploymentAddresses.nonFungiblePositionManager,
      0n,
    );

    const approve0TransactionReceipt = await approve0.execute({
      privateKey: WALLET_KEY,
      rpcUrl: RPC_URL,
    });

    const approve1TransactionReceipt = await approve1.execute({
      privateKey: WALLET_KEY,
      rpcUrl: RPC_URL,
    });

    await transactionMining(RPC_URL, approve0TransactionReceipt.transactionHash.toString());
    await transactionMining(RPC_URL, approve1TransactionReceipt.transactionHash.toString());

    const increaseLiquidityTransaction = await positionManager.increaseLiquidity(position, new Fraction(50, 100), {
      ensureAllowance: true,
      address: WALLET_ADDRESS,
    });

    await increaseLiquidityTransaction.execute({
      rpcUrl: RPC_URL,
      privateKey: WALLET_KEY,
    });

    const increasedPosition = await positionManager.getPositionByTokenId(position.tokenId);
    expect(increasedPosition.liquidity).toBeGreaterThan(position.liquidity);

    const allowance0 = await erc20Facade.allowance(
      position.token0,
      WALLET_ADDRESS,
      config.deploymentAddresses.nonFungiblePositionManager,
    );
    const allowance1 = await erc20Facade.allowance(
      position.token1,
      WALLET_ADDRESS,
      config.deploymentAddresses.nonFungiblePositionManager,
    );

    expect(allowance0).toBe(0n);
    expect(allowance1).toBe(0n);
  });

  it('Should decrease liquidity', async () => {
    const position = await getSamplePosition();

    const decreaseLiquidityTransaction = await positionManager.decreaseLiquidity(position, new Fraction(50, 100));

    const decreaseLiquidityTransactionReceipt = await decreaseLiquidityTransaction.execute({
      privateKey: WALLET_KEY,
      rpcUrl: RPC_URL,
    });

    await transactionMining(RPC_URL, decreaseLiquidityTransactionReceipt.transactionHash.toString());

    const decreasedPosition = await positionManager.getPositionByTokenId(position.tokenId);

    expect(decreasedPosition.liquidity).toBeLessThan(position.liquidity);
    expect(decreasedPosition.liquidity).toBeGreaterThan(0);
  });

  const getSamplePosition = async () => {
    const existingPositions = await positionManager.getActivePositions(WALLET_ADDRESS);

    if (existingPositions.length > 0) {
      return existingPositions[0];
    }

    const mintTransaction = await uniswapPool
      .createMintTransaction()
      .fromPercents({
        percentLower: {
          numerator: 1,
          denominator: 100,
        },
        percentUpper: {
          numerator: 1,
          denominator: 100,
        },
      })
      .fromAmount0(BigInt(10 ** 7))
      .buildTransaction({ recipient: WALLET_ADDRESS });

    const mintTransactionReceipt = await mintTransaction.execute({
      privateKey: WALLET_KEY,
      rpcUrl: RPC_URL,
    });

    await transactionMining(RPC_URL, mintTransactionReceipt.transactionHash.toString());

    const activePositions = await uniswapPool.getActivePositions(WALLET_ADDRESS);

    const createdPosition = activePositions[activePositions.length - 1];

    expect(createdPosition).toBeDefined();

    return createdPosition;
  };
});
