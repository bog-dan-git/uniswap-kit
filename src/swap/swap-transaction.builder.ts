import { Percent, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouter, CurrencyAmount, SwapOptionsSwapRouter02, SwapType } from '@uniswap/smart-order-router';
import { ethers } from 'ethers';
import { Web3 } from 'web3';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { erc20Abi } from '../abis';

export interface SwapConfig {
  slippageTolerance: Percent;
  deadlineSeconds: number;
}

export class SwapTransactionBuilder {
  private readonly swapConfig = {
    slippageTolerance: new Percent(50, 10_000),
    deadlineSeconds: 60 * 20,
  };

  public constructor(
    private readonly tokenInAddress: string,
    private readonly tokenOutAddress: string,
    private readonly recipient: string,
    private readonly rpcUrl: string,
  ) {}

  public async build(amountIn: bigint) {
    const provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);
    const web3 = new Web3(this.rpcUrl);
    web3.registerPlugin(new MulticallPlugin());
    const chainId = Number(await web3.eth.getChainId());
    const erc20In = new web3.eth.Contract(erc20Abi, this.tokenInAddress);
    const erc20Out = new web3.eth.Contract(erc20Abi, this.tokenInAddress);
    const [decimalsIn, symbolIn, decimalsOut, symbolOut] = await web3.multicall.makeMulticall([
      erc20In.methods.decimals(),
      erc20In.methods.symbol(),
      erc20Out.methods.decimals(),
      erc20Out.methods.symbol(),
    ]);

    const tokenIn = new Token(chainId, this.tokenInAddress, Number(decimalsIn), symbolIn);
    const tokenOut = new Token(chainId, this.tokenOutAddress, Number(decimalsOut), symbolOut);
    const router = new AlphaRouter({
      chainId,
      provider,
    });

    const options: SwapOptionsSwapRouter02 = {
      recipient: this.recipient,
      slippageTolerance: this.swapConfig.slippageTolerance,
      deadline: Math.floor(Date.now() / 1000) + this.swapConfig.deadlineSeconds,
      type: SwapType.SWAP_ROUTER_02,
    };

    const route = await router.route(
      CurrencyAmount.fromRawAmount(tokenIn, amountIn.toString()),
      tokenOut,
      TradeType.EXACT_INPUT,
      options,
    );

    if (!route?.route) {
      throw new Error('No route found');
    }

    return route.route;
  }
}
