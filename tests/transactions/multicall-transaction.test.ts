import { Web3 } from 'web3';
import { RPC_URL, TOKEN0_ADDRESS, TOKEN1_ADDRESS, WALLET_ADDRESS, WALLET_KEY } from '../utils';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { UniswapPool } from '../../src/pool/uniswap-pool';
import { FeeAmount } from '@uniswap/v3-sdk';
import { MulticallTransaction } from '../../src/transaction/multicall-transaction';
import { transactionMining } from '../utils/web3';
import { ERC20Facade } from '../../src/erc20';
import { MaxUint256 } from '@uniswap/sdk-core';
import { uniswapConfigByChainId } from '../../src/config';

describe('Multicall transaction tests', () => {
  let pool: UniswapPool;
  let erc20Facade: ERC20Facade;

  beforeAll(async () => {
    pool = await UniswapPool.fromTokens(RPC_URL, {
      token1Address: TOKEN0_ADDRESS,
      token2Address: TOKEN1_ADDRESS,
      fee: FeeAmount.MEDIUM,
    });

    erc20Facade = new ERC20Facade(RPC_URL);
  });

  it('Should create and execute multicall transaction', async () => {
    const web3 = new Web3(RPC_URL);
    web3.registerPlugin(new MulticallPlugin());

    const chainId = await web3.eth.getChainId();

    const config = uniswapConfigByChainId[Number(chainId)];

    const approveTxns = await Promise.all([
      erc20Facade.ensureApproved(
        TOKEN0_ADDRESS,
        BigInt(MaxUint256.toString()),
        WALLET_ADDRESS,
        config.deploymentAddresses.nonFungiblePositionManager,
      ),
      erc20Facade.ensureApproved(
        TOKEN1_ADDRESS,
        BigInt(MaxUint256.toString()),
        WALLET_ADDRESS,
        config.deploymentAddresses.nonFungiblePositionManager,
      ),
    ]);

    const approveTxReceipts = await Promise.all(
      approveTxns.filter((x) => x).map((x) => x!.execute({ rpcUrl: RPC_URL, privateKey: WALLET_KEY })),
    );
    await Promise.all(approveTxReceipts.map((x) => transactionMining(RPC_URL, x.transactionHash.toString())));

    const mint1 = await pool
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

    const mint2 = await pool
      .createMintTransaction()
      .fromPercents({
        percentLower: {
          numerator: -1,
          denominator: 10,
        },
        percentUpper: {
          numerator: 2,
          denominator: 10,
        },
      })
      .fromAmount0(10n ** 6n)
      .buildTransaction({
        recipient: WALLET_ADDRESS,
      });

    const mint3 = await pool
      .createMintTransaction()
      .fromPercents({
        percentLower: {
          numerator: 2,
          denominator: 10,
        },
        percentUpper: {
          numerator: -1,
          denominator: 10,
        },
      })
      .fromAmount1(10n ** 6n)
      .buildTransaction({
        recipient: WALLET_ADDRESS,
      });

    const multicallTransaction = new MulticallTransaction([mint1, mint2, mint3]);

    const txReceipt = await multicallTransaction.execute({
      rpcUrl: RPC_URL,
      privateKey: WALLET_KEY,
    });

    await transactionMining(RPC_URL, txReceipt.transactionHash.toString());
  });
});
