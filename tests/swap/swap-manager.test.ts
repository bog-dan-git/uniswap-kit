import { SwapManager } from '../../src/swap/swap.manager';
import { RPC_URL, TOKEN0_ADDRESS, TOKEN1_ADDRESS, WALLET_ADDRESS, WALLET_KEY } from '../pool/utils';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { Web3 } from 'web3';
import { erc20Abi } from '../../src/abis';
import { transactionMining } from '../pool/utils/web3';
import { Transaction } from '../../src/transaction';
import { uniswapConfigByChainId } from '../../src/config';

describe('Swap manager tests', () => {
  const web3 = new Web3(RPC_URL);
  web3.registerPlugin(new MulticallPlugin());

  const token0Contract = new web3.eth.Contract(erc20Abi, TOKEN0_ADDRESS);
  const token1Contract = new web3.eth.Contract(erc20Abi, TOKEN1_ADDRESS);

  let swapManager: SwapManager;

  beforeAll(async () => {
    swapManager = await SwapManager.create(RPC_URL);
  });

  it('Should swap exact input', async () => {
    const [token0BalanceBefore, token1BalanceBefore] = await getBalances();

    const amountIn = 10n ** 6n;

    const transaction = await swapManager.swapExactInput({
      tokenInAddress: TOKEN0_ADDRESS,
      tokenOutAddress: TOKEN1_ADDRESS,
      amountIn,
      recipient: WALLET_ADDRESS,
    });

    const txReceipt = await transaction.execute({
      rpcUrl: RPC_URL,
      privateKey: WALLET_KEY,
    });

    await transactionMining(RPC_URL, txReceipt.transactionHash.toString());

    const [token0BalanceAfter, token1BalanceAfter] = await getBalances();

    expect(BigInt(token0BalanceAfter)).toEqual(token0BalanceBefore - amountIn);

    expect(token1BalanceAfter).toBeGreaterThan(token1BalanceBefore);
  });

  it('Should ensure allowance for exact input', async () => {
    const chainId = await web3.eth.getChainId();
    const config = uniswapConfigByChainId[Number(chainId)];

    await resetAllowance(TOKEN0_ADDRESS, config.deploymentAddresses.swapRouter02);

    const [token0BalanceBefore, token1BalanceBefore] = await getBalances();
    const amountIn = 10n ** 6n;

    const transaction = await swapManager.swapExactInput({
      tokenInAddress: TOKEN0_ADDRESS,
      tokenOutAddress: TOKEN1_ADDRESS,
      amountIn,
      ensureAllowance: true,
      recipient: WALLET_ADDRESS,
    });

    const txReceipt = await transaction.execute({
      rpcUrl: RPC_URL,
      privateKey: WALLET_KEY,
    });

    console.log(txReceipt);

    const [token0BalanceAfter, token1BalanceAfter] = await getBalances();

    expect(BigInt(token0BalanceAfter)).toEqual(token0BalanceBefore - amountIn);

    expect(token1BalanceAfter).toBeGreaterThan(token1BalanceBefore);
  });

  const getBalances = async (): Promise<[bigint, bigint]> => {
    const [token0Balance, token1Balance] = await web3.multicall.makeMulticall([
      token0Contract.methods.balanceOf(WALLET_ADDRESS),
      token1Contract.methods.balanceOf(WALLET_ADDRESS),
    ]);

    return [BigInt(token0Balance), BigInt(token1Balance)];
  };

  const resetAllowance = async (token: string, spender: string) => {
    const encodedAbi = token0Contract.methods.approve(spender, 0).encodeABI();
    const tx = new Transaction(encodedAbi, '0x0', token);
    const txReceipt = await tx.execute({
      rpcUrl: RPC_URL,
      privateKey: WALLET_KEY,
    });

    await transactionMining(RPC_URL, txReceipt.transactionHash.toString());
  };
});
