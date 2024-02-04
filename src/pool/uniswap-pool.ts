import { computePoolAddress, FeeAmount, Pool } from '@uniswap/v3-sdk';
import { Price, Token } from '@uniswap/sdk-core';
import { Web3 } from 'web3';
import { poolAbi, quoterAbi } from '../abis';
import { MintTransactionBuilder } from './mint-transaction-builder';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { UniswapConfig, uniswapConfigByChainId } from '../config';
import { PositionManager } from '../positions/position-manager';
import { Transaction } from '../transaction';
import { ERC20Facade } from '../erc20';

interface CreatePoolFromTokensParams {
  token1Address: string;
  token2Address: string;
  fee: FeeAmount;
}

export class UniswapPool {
  private readonly erc20Facade = new ERC20Facade(this.rpcUrl);

  private constructor(
    private readonly rpcUrl: string,
    private readonly address: string,
    public readonly config: UniswapConfig,
    private readonly token0: Token,
    private readonly token1: Token,
    private readonly fee: FeeAmount,
  ) {}

  public static async fromAddress(rpcUrl: string, address: string, config?: UniswapConfig): Promise<UniswapPool> {
    const web3 = new Web3(rpcUrl);
    web3.registerPlugin(new MulticallPlugin());
    const chainId = Number(await web3.eth.getChainId());

    if (!config) {
      config = uniswapConfigByChainId[Number(chainId)];

      if (!config) {
        throw new Error(`Uniswap config for chainId ${chainId} not found. Please, specify it manually`);
      }
    }

    const pool = new web3.eth.Contract(poolAbi, address);

    const [token0Address, token1Address, fee] = await web3.multicall.makeMulticall([
      pool.methods.token0(),
      pool.methods.token1(),
      pool.methods.fee(),
    ]);

    const erc20Facade = new ERC20Facade(rpcUrl);

    const [token0, token1] = await erc20Facade.getTokens([token0Address, token1Address]);

    return new UniswapPool(rpcUrl, address, config, token0, token1, Number(fee));
  }

  public static async fromTokens(
    rpcUrl: string,
    { token1Address, token2Address, fee }: CreatePoolFromTokensParams,
    config?: UniswapConfig,
  ): Promise<UniswapPool> {
    const web3 = new Web3(rpcUrl);
    web3.registerPlugin(new MulticallPlugin());
    const chainId = Number(await web3.eth.getChainId());

    if (!config) {
      config = uniswapConfigByChainId[Number(chainId)];

      if (!config) {
        throw new Error(`Uniswap config for chainId ${chainId} not found. Please, specify it manually`);
      }
    }

    const erc20Facade = new ERC20Facade(rpcUrl);
    const [token0, token1] = await erc20Facade.getTokens([token1Address, token2Address]);
    const address = computePoolAddress({
      factoryAddress: config.deploymentAddresses.uniswapV3Factory,
      tokenA: token0,
      tokenB: token1,
      fee,
    });

    const pool = new UniswapPool(rpcUrl, address, config, token0, token1, fee);

    return pool;
  }

  public async getToken0Price(): Promise<Price<Token, Token>> {
    const { web3, contract } = this.getPoolContract();
    const [slot0, liquidity] = await web3.multicall.makeMulticall([
      contract.methods.slot0(),
      contract.methods.liquidity(),
    ]);

    const pool = new Pool(
      this.token0,
      this.token1,
      this.fee!,
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      Number(slot0.tick),
    );

    const price = pool.priceOf(this.token0);

    return price;
  }

  public async getToken1Price(): Promise<Price<Token, Token>> {
    const { web3, contract } = this.getPoolContract();
    const [slot0, liquidity] = await web3.multicall.makeMulticall([
      contract.methods.slot0(),
      contract.methods.liquidity(),
    ]);

    const pool = new Pool(
      this.token0,
      this.token1,
      this.fee!,
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      Number(slot0.tick),
    );

    const price = pool.priceOf(this.token1);

    return price;
  }

  public async getQuoteToken0(amountIn: bigint): Promise<bigint> {
    const quoter = this.getQuoterContract();
    const poolTokens = await this.getPoolTokenAddresses();
    const quote = await quoter.methods
      .quoteExactInputSingle(poolTokens.token0, poolTokens.token1, this.fee, amountIn, 0)
      .call();

    return BigInt(quote);
  }

  public async getQuoteToken1(amountIn: bigint): Promise<bigint> {
    const quoter = this.getQuoterContract();
    const poolTokens = await this.getPoolTokenAddresses();
    const quote = await quoter.methods
      .quoteExactInputSingle(poolTokens.token1, poolTokens.token0, this.fee, amountIn, 0)
      .call();

    return BigInt(quote);
  }

  public async getActivePositions(address: string) {
    const positionManager = await PositionManager.create(this.rpcUrl, this.config);
    const activePositions = await positionManager.getActivePositions(address);

    return activePositions.filter(
      (position) =>
        (position.token0 === this.token0.address && position.token1 === this.token1.address) ||
        (position.token0 === this.token1.address && position.token1 === this.token0.address),
    );
  }

  public async getPoolMetadata() {
    const { contract, web3 } = await this.getPoolContract();

    const [fee, tickSpacing, liquidity, slot0] = await web3.multicall.makeMulticall([
      contract.methods.fee(),
      contract.methods.tickSpacing(),
      contract.methods.liquidity(),
      contract.methods.slot0(),
    ]);

    return {
      fee: BigInt(fee),
      tickSpacing: BigInt(tickSpacing),
      liquidity: BigInt(liquidity),
      sqrtPriceX96: BigInt(slot0.sqrtPriceX96),
      tick: BigInt(slot0.tick),
    };
  }

  public async getPoolTokens(token0Address?: string, token1Address?: string) {
    if (this.token0 && this.token1) {
      return { tokenA: this.token0, tokenB: this.token1 };
    }

    if (!token0Address || !token1Address) {
      const tokenAddresses = await this.getPoolTokenAddresses();
      token0Address = tokenAddresses.token0;
      token1Address = tokenAddresses.token1;
    }

    const web3 = new Web3(this.rpcUrl);
    web3.registerPlugin(new MulticallPlugin());

    const [token0, token1] = await this.erc20Facade.getTokens([token0Address, token1Address]);

    return { tokenA: token0, tokenB: token1 };
  }

  public createMintTransaction() {
    return new MintTransactionBuilder<Transaction>(this);
  }

  private async getPoolTokenAddresses() {
    const { contract, web3 } = this.getPoolContract();
    const [token0, token1] = await web3.multicall.makeMulticall([contract.methods.token0(), contract.methods.token1()]);

    return { token0, token1 };
  }

  private getPoolContract() {
    const web3 = this.getWeb3();
    const contract = new web3.eth.Contract(poolAbi, this.address);

    return { web3, contract };
  }

  private getQuoterContract() {
    const web3 = this.getWeb3();
    const contract = new web3.eth.Contract(quoterAbi, this.config.deploymentAddresses.quoter);

    return contract;
  }

  private getWeb3() {
    const web3 = new Web3(this.rpcUrl);
    web3.registerPlugin(new MulticallPlugin());

    return web3;
  }
}
