import { Percent } from '../core/models/percent';
import { Percent as UniPercent, TradeType } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { Web3 } from 'web3';
import { AlphaRouter, CurrencyAmount, SwapOptionsSwapRouter02, SwapType } from '@uniswap/smart-order-router';
import { getTokens } from '../core/utils';
import { erc20Abi } from '../abis';
import { BaseUniService } from '../core/base-uni.service';
import { UniswapConfig } from '../config';
import { MultistepTransaction, Transaction } from '../transaction';

interface CreateSwapTransactionParams {
  tokenInAddress: string;
  tokenOutAddress: string;
  recipient: string;
  slippage?: Percent;
  deadline?: Date;
  ensureAllowance?: boolean;
}

interface CreateSwapExactInputTransactionParams extends CreateSwapTransactionParams {
  amountIn: bigint;
}

interface CreateSwapExactOutputTransactionParams extends CreateSwapTransactionParams {
  amountOut: bigint;
}

type SwapReturnType<T extends CreateSwapTransactionParams> = T extends {
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

  public async swapExactInput<T extends CreateSwapExactInputTransactionParams>(params: T): Promise<SwapReturnType<T>> {
    const { tokenInAddress, tokenOutAddress, amountIn, slippage, deadline, ensureAllowance, recipient } =
      this.validateParams(params);

    const route = await this.getRoute(
      tokenInAddress,
      tokenOutAddress,
      recipient,
      slippage,
      deadline,
      amountIn,
      TradeType.EXACT_INPUT,
    );

    const { methodParameters } = route;

    const transactions: Transaction[] = [];

    if (ensureAllowance) {
      const allowance = await this.getAllowanceCalldata(tokenInAddress, recipient, amountIn);

      if (allowance) {
        transactions.push(new Transaction(allowance, '0x0', tokenInAddress));
      }
    }

    transactions.push(new Transaction(methodParameters!.calldata, '0x0', this.config.deploymentAddresses.swapRouter02));

    return (params.ensureAllowance ? new MultistepTransaction(transactions) : transactions[0]) as SwapReturnType<T>;
  }

  public async swapExactOutput<T extends CreateSwapExactOutputTransactionParams>(
    params: T,
  ): Promise<SwapReturnType<T>> {
    const { tokenInAddress, tokenOutAddress, amountOut, slippage, deadline, ensureAllowance, recipient } =
      this.validateParams(params);

    const { quote, methodParameters } = await this.getRoute(
      tokenInAddress,
      tokenOutAddress,
      recipient,
      slippage,
      deadline,
      amountOut,
      TradeType.EXACT_OUTPUT,
    );

    const transactions: Transaction[] = [];

    if (ensureAllowance) {
      const amountToApprove = BigInt(quote.numerator.toString()) / BigInt(quote.denominator.toString());

      const allowance = await this.getAllowanceCalldata(tokenInAddress, recipient, amountToApprove);

      if (allowance) {
        transactions.push(new Transaction(allowance, '0x0', tokenInAddress));
      }
    }

    transactions.push(new Transaction(methodParameters!.calldata, '0x0', this.config.deploymentAddresses.swapRouter02));

    return (params.ensureAllowance ? new MultistepTransaction(transactions) : transactions[0]) as SwapReturnType<T>;
  }

  private async getAllowanceCalldata(
    tokenInAddress: string,
    recipient: string,
    amount: bigint,
  ): Promise<string | undefined> {
    const web3 = new Web3(this.rpcUrl);
    const erc20 = new web3.eth.Contract(erc20Abi, tokenInAddress);
    const allowance = await erc20.methods.allowance(recipient, this.config.deploymentAddresses.swapRouter02).call();

    if (BigInt(allowance) < amount) {
      const approveCalldata = erc20.methods
        .approve(this.config.deploymentAddresses.swapRouter02, amount.toString())
        .encodeABI();

      return approveCalldata;
    }
  }

  private async getRoute(
    tokenInAddress: string,
    tokenOutAddress: string,
    recipient: string,
    slippage: Percent,
    deadline: Date,
    amount: bigint,
    type: TradeType,
  ) {
    const provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);

    const chainId = await provider.getNetwork().then((x) => x.chainId);
    const router = new AlphaRouter({
      chainId,
      provider,
    });

    const [tokenIn, tokenOut] = await getTokens(this.rpcUrl, [tokenInAddress, tokenOutAddress]);

    const options: SwapOptionsSwapRouter02 = {
      recipient,
      slippageTolerance: new UniPercent(slippage.numerator, slippage.denominator),
      deadline: deadline!.getTime(),
      type: SwapType.SWAP_ROUTER_02,
    };

    const token0 = type === TradeType.EXACT_INPUT ? tokenIn : tokenOut;
    const token1 = type === TradeType.EXACT_INPUT ? tokenOut : tokenIn;

    const route = await router.route(CurrencyAmount.fromRawAmount(token0, amount.toString()), token1, type, options);

    if (!route || !route?.route || !route?.methodParameters) {
      throw new Error('No route found');
    }

    return route;
  }

  private validateParams<T extends CreateSwapTransactionParams>(params: T) {
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
