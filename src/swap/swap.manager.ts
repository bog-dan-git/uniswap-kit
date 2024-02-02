import { Percent } from '../core/models/percent';
import { Percent as UniPercent, TradeType } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { Web3 } from 'web3';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { AlphaRouter, CurrencyAmount, SwapOptionsSwapRouter02, SwapType } from '@uniswap/smart-order-router';
import { getTokens } from '../core/utils';
import { erc20Abi } from '../abis';
import { BaseUniService } from '../core/base-uni.service';
import { UniswapConfig } from '../config';
import { MultistepTransaction, Transaction } from '../transaction';

interface CreateSwapTransactionParams {
  tokenInAddress: string;
  tokenOutAddress: string;
  amountIn: bigint;
  recipient: string;
  slippage?: Percent;
  deadline?: Date;
  ensureAllowance?: boolean;
}

type SwapExactInputReturnType<T extends CreateSwapTransactionParams> = T extends {
  ensureAllowance: true;
}
  ? MultistepTransaction
  : T extends {
      ensureAllowance?: boolean;
    }
  ? MultistepTransaction | Transaction
  : Transaction;

export class SwapManager extends BaseUniService {
  public constructor(rpcUrl: string, config: UniswapConfig) {
    super(rpcUrl, config);
  }

  public static async create(rpcUrl: string) {
    const config = await BaseUniService.validateConfig(rpcUrl);
    return new SwapManager(rpcUrl, config);
  }

  public async swapExactInput<T extends CreateSwapTransactionParams>(params: T): Promise<SwapExactInputReturnType<T>> {
    const { tokenInAddress, tokenOutAddress, amountIn, slippage, deadline, ensureAllowance, recipient } =
      this.validateParams(params);
    const provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);
    const web3 = new Web3(this.rpcUrl);
    web3.registerPlugin(new MulticallPlugin());
    const chainId = Number(await web3.eth.getChainId());
    const [tokenIn, tokenOut] = await getTokens(this.rpcUrl, [tokenInAddress, tokenOutAddress]);
    const router = new AlphaRouter({
      chainId,
      provider,
    });

    const options: SwapOptionsSwapRouter02 = {
      recipient,
      slippageTolerance: new UniPercent(slippage.numerator, slippage.denominator),
      deadline: deadline!.getTime(),
      type: SwapType.SWAP_ROUTER_02,
    };

    const route = await router.route(
      CurrencyAmount.fromRawAmount(tokenIn, amountIn.toString()),
      tokenOut,
      TradeType.EXACT_INPUT,
      options,
    );

    if (!route?.route || !route?.methodParameters) {
      throw new Error('No route found');
    }

    const { calldata } = route.methodParameters;

    const transactions: Transaction[] = [];

    if (ensureAllowance) {
      const erc20 = new web3.eth.Contract(erc20Abi, tokenInAddress);
      const allowance = await erc20.methods.allowance(recipient, this.config.deploymentAddresses.swapRouter02).call();
      if (BigInt(allowance) < amountIn) {
        const approveCalldata = erc20.methods
          .approve(this.config.deploymentAddresses.swapRouter02, amountIn.toString())
          .encodeABI();
        transactions.push(new Transaction(approveCalldata, '0x0', tokenInAddress));
      }
    }

    transactions.push(new Transaction(calldata, '0x0', this.config.deploymentAddresses.swapRouter02));

    return (
      params.ensureAllowance ? new MultistepTransaction(transactions) : transactions[0]
    ) as SwapExactInputReturnType<T>;
  }

  private validateParams(params: CreateSwapTransactionParams) {
    if (!params.tokenInAddress) {
      throw new Error('Token in address not specified');
    }

    if (!params.tokenOutAddress) {
      throw new Error('Token out address not specified');
    }

    const defaultDeadline = new Date(Date.now() + 60 * 20 * 1000);
    const defaultSlippage: Percent = { numerator: 50, denominator: 10_000 };

    return {
      ...params,
      deadline: params.deadline ?? defaultDeadline,
      slippage: params.slippage ?? defaultSlippage,
      ensureAllowance: params.ensureAllowance ?? false,
    };
  }
}