import { UniswapPool } from '../../src/pool/uniswap-pool';
import { FeeAmount } from '@uniswap/v3-sdk';
import { RPC_URL, WALLET_ADDRESS, WALLET_KEY, TOKEN0_ADDRESS, TOKEN1_ADDRESS } from '../utils';
import { transactionMining } from '../utils/web3';
import { PositionManager } from '../../src/positions/position-manager';
import { ERC20Facade } from '../../src/erc20';

describe('Mint tests', () => {
  let pool!: UniswapPool;
  let erc20Facade!: ERC20Facade;

  beforeAll(async () => {
    pool = await UniswapPool.fromTokens(RPC_URL, {
      token1Address: TOKEN1_ADDRESS,
      token2Address: TOKEN0_ADDRESS,
      fee: FeeAmount.MEDIUM,
    });
    erc20Facade = new ERC20Facade(RPC_URL);

    const activePositions = await pool.getActivePositions(WALLET_ADDRESS);

    const positionManager = await PositionManager.create(RPC_URL);
    const closeAndBurnPositionTransactions = await Promise.all(
      activePositions.map((x) => positionManager.closeAndBurnPosition(x.tokenId, WALLET_ADDRESS)),
    );

    for (const transaction of closeAndBurnPositionTransactions) {
      try {
        const txReceipt = await transaction.execute({
          rpcUrl: RPC_URL,
          privateKey: WALLET_KEY,
          gas: 1_000_000n,
        });

        await transactionMining(RPC_URL, txReceipt.transactionHash.toString());
      } catch (e) {
        console.error(e);
      }
    }
  });
  describe('Mint from amount 0 and percent range', () => {
    it('Should mint position from amount 0 and percent range', async () => {
      const transaction = await pool
        .createMintTransaction()
        .fromPercents({
          percentLower: {
            numerator: 1,
            denominator: 10,
          },
          percentUpper: {
            numerator: 1,
            denominator: 10,
          },
        })
        .fromAmount0(10n ** 6n)
        .buildTransaction({
          recipient: WALLET_ADDRESS,
        });

      const txReceipt = await transaction.execute({
        rpcUrl: RPC_URL,
        privateKey: WALLET_KEY,
      });

      await transactionMining(RPC_URL, txReceipt.transactionHash.toString());

      const activePositions = await pool.getActivePositions(WALLET_ADDRESS);
      expect(activePositions.length).toBe(1);

      const position = activePositions[0];

      expect(position.liquidity).toBeGreaterThan(0n);

      const positionManager = await PositionManager.create(RPC_URL);
      const burnTx = await positionManager.closeAndBurnPosition(position, WALLET_ADDRESS).then((x) =>
        x.execute({
          rpcUrl: RPC_URL,
          privateKey: WALLET_KEY,
        }),
      );

      await transactionMining(RPC_URL, burnTx.transactionHash.toString());
    });
  });
  describe('Mint from amount 1 and percent range', () => {
    it('Should mint position from amount 1 and percent range', async () => {
      const transaction = await pool
        .createMintTransaction()
        .fromPercents({
          percentLower: {
            numerator: 1,
            denominator: 10,
          },
          percentUpper: {
            numerator: 1,
            denominator: 10,
          },
        })
        .fromAmount1(10n ** 6n)
        .buildTransaction({
          recipient: WALLET_ADDRESS,
        });

      const txReceipt = await transaction.execute({
        rpcUrl: RPC_URL,
        privateKey: WALLET_KEY,
      });

      await transactionMining(RPC_URL, txReceipt.transactionHash.toString());

      const activePositions = await pool.getActivePositions(WALLET_ADDRESS);
      expect(activePositions.length).toBe(1);

      const position = activePositions[0];

      expect(position.liquidity).toBeGreaterThan(0n);

      const positionManager = await PositionManager.create(RPC_URL);
      const burnTx = await positionManager.closeAndBurnPosition(position, WALLET_ADDRESS).then((x) =>
        x.execute({
          rpcUrl: RPC_URL,
          privateKey: WALLET_KEY,
        }),
      );

      await transactionMining(RPC_URL, burnTx.transactionHash.toString());
    });
  });

  it('Should mint with approval', async () => {
    const reset0 = await erc20Facade
      .approve(TOKEN0_ADDRESS, pool.config.deploymentAddresses.nonFungiblePositionManager, 0n)
      .then((x) => x.execute({ rpcUrl: RPC_URL, privateKey: WALLET_KEY }));
    const reset1 = await erc20Facade
      .approve(TOKEN1_ADDRESS, pool.config.deploymentAddresses.nonFungiblePositionManager, 0n)
      .then((x) => x.execute({ rpcUrl: RPC_URL, privateKey: WALLET_KEY }));

    await transactionMining(RPC_URL, reset0.transactionHash.toString());
    await transactionMining(RPC_URL, reset1.transactionHash.toString());

    const transaction = await pool
      .createMintTransaction()
      .fromPercents({
        percentLower: {
          numerator: 1,
          denominator: 10,
        },
        percentUpper: {
          numerator: 1,
          denominator: 10,
        },
      })
      .fromAmount0(10n ** 6n)
      .verifyAllowance(WALLET_ADDRESS)
      .buildTransaction({
        recipient: WALLET_ADDRESS,
      });

    await transaction.execute({
      rpcUrl: RPC_URL,
      privateKey: WALLET_KEY,
    });

    const activePositions = await pool.getActivePositions(WALLET_ADDRESS);
    expect(activePositions.length).toBe(1);

    const position = activePositions[0];

    expect(position.liquidity).toBeGreaterThan(0n);

    const allowance0 = await erc20Facade.allowance(
      TOKEN0_ADDRESS,
      WALLET_ADDRESS,
      pool.config.deploymentAddresses.nonFungiblePositionManager,
    );
    const allowance1 = await erc20Facade.allowance(
      TOKEN1_ADDRESS,
      WALLET_ADDRESS,
      pool.config.deploymentAddresses.nonFungiblePositionManager,
    );

    expect(allowance0).toBe(0n);
    expect(allowance1).toBe(0n);

    const positionManager = await PositionManager.create(RPC_URL);
    const burnTx = await positionManager.closeAndBurnPosition(position, WALLET_ADDRESS).then((x) =>
      x.execute({
        rpcUrl: RPC_URL,
        privateKey: WALLET_KEY,
      }),
    );

    await transactionMining(RPC_URL, burnTx.transactionHash.toString());
  });
  it('Should get pool token addresses', () => {});
  it('Should get token0 price', () => {});
  it('Should get token1 price', () => {});
  it('Should get quote token0', () => {});
  it('Should get quote token1', () => {});
});
