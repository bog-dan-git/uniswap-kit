import { RPC_URL, TOKEN0_ADDRESS, TOKEN1_ADDRESS, WALLET_ADDRESS, WALLET_KEY } from '../utils';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { Web3 } from 'web3';
import { PositionManager } from '../../src/positions/position-manager';
import { UniswapPool } from '../../src/pool/uniswap-pool';
import { FeeAmount } from '@uniswap/v3-sdk';
import { transactionMining } from '../utils/web3';
import { Fraction } from '@uniswap/sdk-core';

describe('Position manager tests', () => {
  const web3 = new Web3(RPC_URL);
  web3.registerPlugin(new MulticallPlugin());

  let positionManager: PositionManager;
  let uniswapPool: UniswapPool;

  beforeAll(async () => {
    positionManager = await PositionManager.create(RPC_URL);
    uniswapPool = await UniswapPool.fromTokens(RPC_URL, {
      token1Address: TOKEN0_ADDRESS,
      token2Address: TOKEN1_ADDRESS,
      fee: FeeAmount.MEDIUM,
    });
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
