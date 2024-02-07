import { BaseUniService } from '../core/base-uni.service';
import { UniswapConfig } from '../config';
import { nonFungiblePositionManagerAbi, poolAbi } from '../abis';
import {
  AddLiquidityOptions,
  ADDRESS_ZERO,
  computePoolAddress,
  FeeAmount,
  NonfungiblePositionManager,
  Pool,
  Position,
  RemoveLiquidityOptions,
} from '@uniswap/v3-sdk';
import { Fraction, Percent as UniPercent, Token } from '@uniswap/sdk-core';
import {
  AlphaRouter,
  CurrencyAmount,
  SwapAndAddConfig,
  SwapAndAddOptions,
  SwapToRatioResponse,
  SwapToRatioStatus,
  SwapType,
} from '@uniswap/smart-order-router';
import { MultistepTransaction, Transaction } from '../transaction';
import { ethers } from 'ethers';
import { ERC20Facade } from '../erc20';
import { Percent } from '../core/models/percent';
import { DEFAULT_DEADLINE_SECONDS, DEFAULT_SLIPPAGE_TOLERANCE } from '../core/settings';

const MAX_UINT128 = '0xffffffffffffffffffffffffffffffff';

export interface ApprovableTransactionOptions {
  ensureAllowance?: boolean;
}

type ApprovableTransactionReturnType<T extends ApprovableTransactionOptions> = T extends {
  ensureAllowance: infer K;
}
  ? K extends true
    ? MultistepTransaction
    : K extends false | undefined
    ? Transaction
    : MultistepTransaction | Transaction
  : Transaction;

export interface PositionInfo {
  readonly nonce: number;
  readonly operator: string;
  readonly token0: string;
  readonly token1: string;
  readonly fee: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  readonly feeGrowthInside0LastX128: bigint;
  readonly feeGrowthInside1LastX128: bigint;
  readonly tokensOwed0: bigint;
  readonly tokensOwed1: bigint;
  readonly tokenId: bigint;
}

export interface PositionTransactionOptions extends ApprovableTransactionOptions {
  slippageTolerance?: Percent;
  deadline?: Date;
  recipient?: string;
  address?: string;
}

export interface SwapAndAddTransactionOptions extends PositionTransactionOptions, ApprovableTransactionOptions {
  token0Amount: bigint;
  token1Amount: bigint;
  address: string;
  ratioErrorTolerance?: Fraction;
  maxIterations?: number;
}

export interface RemoveLiquidityTransactionOptions extends PositionTransactionOptions {
  collectRewards: boolean;
}

export class PositionManager extends BaseUniService {
  private readonly erc20Facade = new ERC20Facade(this.rpcUrl);

  private constructor(rpcUrl: string, config: UniswapConfig) {
    super(rpcUrl, config);
  }

  public static async create(rpcUrl: string, config?: UniswapConfig) {
    config = await super.validateConfig(rpcUrl, config);
    return new PositionManager(rpcUrl, config);
  }

  public async getPositionTokenIds(address: string): Promise<bigint[]> {
    const { contract, web3 } = this.getNonFungiblePositionManagerContract();
    const balance = Number(await contract.methods.balanceOf(address).call());

    const positionIds = await web3.multicall.makeMulticall(
      Array(balance)
        .fill(0)
        .map((_, i) => contract.methods.tokenOfOwnerByIndex(address, i)),
    );

    return positionIds.map((x) => BigInt(x));
  }

  public async getPositionByTokenId(tokenId: bigint): Promise<PositionInfo> {
    const { contract } = this.getNonFungiblePositionManagerContract();
    const positionInfo = await contract.methods.positions(tokenId.toString()).call();
    return {
      tokenId,
      nonce: Number(positionInfo.nonce),
      operator: positionInfo.operator,
      token0: positionInfo.token0,
      token1: positionInfo.token1,
      fee: Number(positionInfo.fee),
      tickLower: Number(positionInfo.tickLower),
      tickUpper: Number(positionInfo.tickUpper),
      liquidity: BigInt(positionInfo.liquidity),
      feeGrowthInside0LastX128: BigInt(positionInfo.feeGrowthInside0LastX128),
      feeGrowthInside1LastX128: BigInt(positionInfo.feeGrowthInside1LastX128),
      tokensOwed0: BigInt(positionInfo.tokensOwed0),
      tokensOwed1: BigInt(positionInfo.tokensOwed1),
    };
  }

  public async getAllPositions(address: string): Promise<PositionInfo[]> {
    const positions = await this.getPositionTokenIds(address);
    const { contract, web3 } = this.getNonFungiblePositionManagerContract();

    const positionInfos = await web3.multicall.makeMulticall(
      positions.map((tokenId) => contract.methods.positions(tokenId)),
    );

    return positionInfos.map((positionInfo, index) => ({
      tokenId: positions[index],
      nonce: Number(positionInfo.nonce),
      operator: positionInfo.operator,
      token0: positionInfo.token0,
      token1: positionInfo.token1,
      fee: Number(positionInfo.fee),
      tickLower: Number(positionInfo.tickLower),
      tickUpper: Number(positionInfo.tickUpper),
      liquidity: BigInt(positionInfo.liquidity),
      feeGrowthInside0LastX128: BigInt(positionInfo.feeGrowthInside0LastX128),
      feeGrowthInside1LastX128: BigInt(positionInfo.feeGrowthInside1LastX128),
      tokensOwed0: BigInt(positionInfo.tokensOwed0),
      tokensOwed1: BigInt(positionInfo.tokensOwed1),
    }));
  }

  public async swapAndAddLiquidity(tokenId: bigint, params: SwapAndAddTransactionOptions): Promise<Transaction>;
  public async swapAndAddLiquidity(position: PositionInfo, params: SwapAndAddTransactionOptions): Promise<Transaction>;
  public async swapAndAddLiquidity(
    positionOrTokenId: bigint | PositionInfo,
    params: SwapAndAddTransactionOptions,
  ): Promise<Transaction> {
    if (typeof positionOrTokenId === 'bigint') {
      positionOrTokenId = await this.getPositionByTokenId(positionOrTokenId);
    }

    const { deadline, slippageTolerance, recipient } = this.validateOptions(params);
    const ratioErrorTolerance = params.ratioErrorTolerance ?? new Fraction(10, 100);
    const maxIterations = params.maxIterations ?? 6;

    const { web3 } = this.getSwapRouter();

    const chainId = await web3.eth.getChainId();

    const router = new AlphaRouter({
      chainId: Number(chainId),
      provider: new ethers.providers.JsonRpcProvider(this.rpcUrl),
    });

    const [token0, token1] = await this.erc20Facade.getTokens([positionOrTokenId.token0, positionOrTokenId.token1]);

    const token0CurrencyAmount = CurrencyAmount.fromRawAmount(token0, params.token0Amount.toString());
    const token1CurrencyAmount = CurrencyAmount.fromRawAmount(token1, params.token1Amount.toString());

    const pool = await this.getPool(token0, token1, positionOrTokenId.fee);

    const placeholderPosition = new Position({
      pool,
      liquidity: 1,
      tickLower: positionOrTokenId.tickLower,
      tickUpper: positionOrTokenId.tickUpper,
    });

    const swapAndAddConfig: SwapAndAddConfig = {
      ratioErrorTolerance,
      maxIterations,
    };

    const swapAndAddOptions: SwapAndAddOptions = {
      swapOptions: {
        type: SwapType.SWAP_ROUTER_02,
        recipient,
        slippageTolerance: new UniPercent(slippageTolerance.numerator, slippageTolerance.denominator),
        deadline: Math.floor(deadline.getTime() / 1000),
      },
      addLiquidityOptions: {
        tokenId: positionOrTokenId.tokenId.toString(),
      },
    };

    const routeToRatioResponse: SwapToRatioResponse = await router.routeToRatio(
      token0CurrencyAmount,
      token1CurrencyAmount,
      placeholderPosition,
      swapAndAddConfig,
      swapAndAddOptions,
    );

    if (routeToRatioResponse.status === SwapToRatioStatus.SUCCESS) {
      const { calldata, value } = routeToRatioResponse.result.methodParameters!;

      return new Transaction(calldata, value, this.config.deploymentAddresses.swapRouter02);
    }

    throw new Error('Error');
  }

  public async getFees(tokenId: bigint) {
    const { contract } = this.getNonFungiblePositionManagerContract();

    const result = await contract.methods
      .collect({
        tokenId: tokenId.toString(),
        recipient: ADDRESS_ZERO,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      })
      .call();

    return {
      fee0: BigInt(result[0]),
      fee1: BigInt(result[1]),
    };
  }

  public async closeAndBurnPosition(
    position: PositionInfo,
    recipient: string,
    transactionOptions?: PositionTransactionOptions,
  ): Promise<Transaction>;

  public async closeAndBurnPosition(
    tokenId: bigint,
    recipient: string,
    transactionOptions?: PositionTransactionOptions,
  ): Promise<Transaction>;

  public async closeAndBurnPosition(
    positionOrTokenId: PositionInfo | bigint,
    recipient: string,
    transactionOptions?: PositionTransactionOptions,
  ): Promise<Transaction> {
    if (typeof positionOrTokenId === 'bigint') {
      positionOrTokenId = await this.getPositionByTokenId(positionOrTokenId);
    }
    const { fee0, fee1 } = await this.getFees(positionOrTokenId.tokenId);
    const [token0, token1] = await this.erc20Facade.getTokens([positionOrTokenId.token0, positionOrTokenId.token1]);

    const { deadline, slippageTolerance } = this.validateOptions(transactionOptions);

    const removeLiquidityOptions: RemoveLiquidityOptions = {
      deadline: Math.floor(deadline.getTime() / 1000),
      tokenId: positionOrTokenId.tokenId.toString(),
      slippageTolerance: new UniPercent(slippageTolerance.numerator, slippageTolerance.denominator),
      liquidityPercentage: new UniPercent(1),
      burnToken: true,
      collectOptions: {
        expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(token0, fee0.toString()),
        expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(token1, fee1.toString()),
        recipient,
      },
    };

    const pool = await this.getPool(token0, token1, positionOrTokenId.fee);

    const params = NonfungiblePositionManager.removeCallParameters(
      new Position({
        pool,
        liquidity: positionOrTokenId.liquidity.toString(),
        tickUpper: positionOrTokenId.tickUpper,
        tickLower: positionOrTokenId.tickLower,
      }),
      removeLiquidityOptions,
    );

    const { calldata, value } = params;

    return new Transaction(calldata, value, this.config.deploymentAddresses.nonFungiblePositionManager);
  }

  public async increaseLiquidity<T extends PositionTransactionOptions>(
    position: PositionInfo,
    fractionToAdd: Fraction,
    options?: T,
  ): Promise<ApprovableTransactionReturnType<T>> {
    const [token0, token1] = await this.erc20Facade.getTokens([position.token0, position.token1]);

    const pool = await this.getPool(token0, token1, position.fee);

    const currentPosition = new Position({
      pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity.toString(),
    });

    const { amount0, amount1 } = currentPosition;
    const newAmount0 = amount0.multiply(fractionToAdd);
    const newAmount1 = amount1.multiply(fractionToAdd);

    const newPosition = Position.fromAmounts({
      pool,
      amount0: newAmount0.quotient,
      amount1: newAmount1.quotient,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      useFullPrecision: true,
    });

    const { deadline, slippageTolerance } = this.validateOptions(options);

    const addLiquidityOptions: AddLiquidityOptions = {
      deadline: Math.floor(deadline.getTime() / 1000),
      slippageTolerance: new UniPercent(slippageTolerance.numerator, slippageTolerance.denominator),
      tokenId: position.tokenId.toString(),
    };

    const { calldata, value } = NonfungiblePositionManager.addCallParameters(newPosition, addLiquidityOptions);

    const increaseLiquidityTransaction = new Transaction(
      calldata,
      value,
      this.config.deploymentAddresses.nonFungiblePositionManager,
    );

    const transactions = [];

    if (options?.ensureAllowance) {
      const diff0 = BigInt(newAmount0.subtract(amount0).quotient.toString());
      const diff1 = BigInt(newAmount1.subtract(amount1).quotient.toString());

      if (!options.address) {
        throw new Error('Address is required to ensure allowance');
      }

      const tx0 = await this.erc20Facade.ensureApproved(
        token0.address,
        diff0,
        options.address,
        this.config.deploymentAddresses.nonFungiblePositionManager,
      );

      if (tx0) {
        transactions.push(tx0);
      }

      const tx1 = await this.erc20Facade.ensureApproved(
        token1.address,
        diff1,
        options.address,
        this.config.deploymentAddresses.nonFungiblePositionManager,
      );

      if (tx1) {
        transactions.push(tx1);
      }

      transactions.push(increaseLiquidityTransaction);

      return new MultistepTransaction(transactions) as ApprovableTransactionReturnType<T>;
    }

    return new Transaction(
      calldata,
      value,
      this.config.deploymentAddresses.nonFungiblePositionManager,
    ) as ApprovableTransactionReturnType<T>;
  }

  public async decreaseLiquidity(
    tokenId: bigint,
    fractionToRemove: Fraction,
    options?: RemoveLiquidityTransactionOptions,
  ): Promise<Transaction>;
  public async decreaseLiquidity(
    position: PositionInfo,
    fractionToRemove: Fraction,
    options?: RemoveLiquidityTransactionOptions,
  ): Promise<Transaction>;
  public async decreaseLiquidity(
    position: bigint | PositionInfo,
    fractionToRemove: Fraction,
    options?: RemoveLiquidityTransactionOptions,
  ): Promise<Transaction> {
    if (typeof position === 'bigint') {
      position = await this.getPositionByTokenId(position);
    }

    const { fee0, fee1 } = await this.getFees(position.tokenId);
    const [token0, token1] = await this.erc20Facade.getTokens([position.token0, position.token1]);

    const { deadline, slippageTolerance, recipient } = this.validateOptions(options);
    const collectRewards = options?.collectRewards;

    const collectOptions = {
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(token0, collectRewards ? fee0.toString() : '0x0'),
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(token1, collectRewards ? fee1.toString() : '0x0'),
      recipient,
    };

    const removeLiquidityOptions: RemoveLiquidityOptions = {
      deadline: Math.floor(deadline.getTime() / 1000),
      tokenId: position.tokenId.toString(),
      slippageTolerance: new UniPercent(slippageTolerance.numerator, slippageTolerance.denominator),
      liquidityPercentage: new UniPercent(fractionToRemove.numerator, fractionToRemove.denominator),
      burnToken: false,
      collectOptions,
    };

    const pool = await this.getPool(token0, token1, position.fee);

    const params = NonfungiblePositionManager.removeCallParameters(
      new Position({
        pool,
        liquidity: position.liquidity.toString(),
        tickUpper: position.tickUpper,
        tickLower: position.tickLower,
      }),
      removeLiquidityOptions,
    );

    const { calldata, value } = params;

    return new Transaction(calldata, value, this.config.deploymentAddresses.nonFungiblePositionManager);
  }

  public async getActivePositions(address: string): Promise<PositionInfo[]> {
    const allPositions = await this.getAllPositions(address);

    return allPositions.filter((position) => position.liquidity > 0);
  }

  private async getPool(token0: Token, token1: Token, fee: FeeAmount): Promise<Pool> {
    const web3 = this.getWeb3();
    const poolAddress = computePoolAddress({
      factoryAddress: this.config.deploymentAddresses.uniswapV3Factory,
      tokenA: token0,
      tokenB: token1,
      fee,
    });
    const contract = new web3.eth.Contract(poolAbi, poolAddress);

    const [slot0, liquidity] = await web3.multicall.makeMulticall([
      contract.methods.slot0(),
      contract.methods.liquidity(),
    ]);

    return new Pool(token0, token1, fee, slot0.sqrtPriceX96.toString(), liquidity.toString(), Number(slot0.tick));
  }

  private getNonFungiblePositionManagerContract() {
    const web3 = this.getWeb3();
    const contract = new web3.eth.Contract(
      nonFungiblePositionManagerAbi,
      this.config.deploymentAddresses.nonFungiblePositionManager,
    );

    return { contract, web3 };
  }

  private getSwapRouter() {
    const web3 = this.getWeb3();
    const contract = new web3.eth.Contract(nonFungiblePositionManagerAbi, this.config.deploymentAddresses.swapRouter02);

    return { contract, web3 };
  }

  private validateOptions(options?: PositionTransactionOptions) {
    const deadline = options?.deadline ?? new Date(Date.now() + DEFAULT_DEADLINE_SECONDS * 1000);
    const slippageTolerance = options?.slippageTolerance ?? DEFAULT_SLIPPAGE_TOLERANCE;
    const recipient = options?.recipient ?? ADDRESS_ZERO;
    return { ...options, deadline, slippageTolerance, recipient };
  }
}
