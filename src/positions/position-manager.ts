import { BaseUniService } from '../core/base-uni.service';
import { UniswapConfig } from '../config';
import { nonFungiblePositionManagerAbi, poolAbi } from '../abis';
import {
  ADDRESS_ZERO,
  computePoolAddress,
  FeeAmount,
  NonfungiblePositionManager,
  Pool,
  Position,
  RemoveLiquidityOptions,
} from '@uniswap/v3-sdk';
import { Fraction, Percent, Token } from '@uniswap/sdk-core';
import {
  AlphaRouter,
  CurrencyAmount,
  SwapAndAddConfig,
  SwapAndAddOptions,
  SwapToRatioResponse,
  SwapToRatioStatus,
  SwapType,
} from '@uniswap/smart-order-router';
import { Transaction } from '../transaction';
import { ethers } from 'ethers';
import { ERC20Facade } from '../erc20';

const MAX_UINT128 = '0xffffffffffffffffffffffffffffffff';

type SwapAndAddParams = {
  token0Amount: bigint;
  token1Amount: bigint;
  address: string;
  slippageTolerance?: Percent;
  deadline?: Date;
  ratioErrorTolerance?: Fraction;
  maxIterations?: number;
};

export interface PositionInfo {
  nonce: number;
  operator: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  tokenId: bigint;
}

export class PositionManager extends BaseUniService {
  private readonly erc20Facade = new ERC20Facade(this.rpcUrl);

  private constructor(rpcUrl: string, config: UniswapConfig) {
    super(rpcUrl, config);
  }

  public static async create(rpcUrl: string, config?: UniswapConfig) {
    config = await super.validateConfig(rpcUrl, config);
    const positionManager = new PositionManager(rpcUrl, config);

    return positionManager;
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

  public async swapAndAddLiquidity(positionInfo: PositionInfo, params: SwapAndAddParams) {
    const deadline = params.deadline ?? new Date(Date.now() + 60 * 20 * 1000);
    const slippageTolerance = params.slippageTolerance ?? new Percent(50, 10_000);
    const ratioErrorTolerance = params.ratioErrorTolerance ?? new Fraction(10, 100);
    const maxIterations = params.maxIterations ?? 6;

    const { web3 } = this.getSwapRouter();

    const chainId = await web3.eth.getChainId();

    const router = new AlphaRouter({
      chainId: Number(chainId),
      provider: new ethers.providers.JsonRpcProvider(this.rpcUrl),
    });

    const [token0, token1] = await this.erc20Facade.getTokens([positionInfo.token0, positionInfo.token1]);

    const token0CurrencyAmount = CurrencyAmount.fromRawAmount(token0, params.token0Amount.toString());
    const token1CurrencyAmount = CurrencyAmount.fromRawAmount(token1, params.token1Amount.toString());

    const pool = await this.getPool(token0, token1, positionInfo.fee);

    const placeholderPosition = new Position({
      pool,
      liquidity: 1,
      tickLower: positionInfo.tickLower,
      tickUpper: positionInfo.tickUpper,
    });

    const swapAndAddConfig: SwapAndAddConfig = {
      ratioErrorTolerance,
      maxIterations,
    };

    const swapAndAddOptions: SwapAndAddOptions = {
      swapOptions: {
        type: SwapType.SWAP_ROUTER_02,
        recipient: params.address,
        slippageTolerance,
        deadline: deadline.getTime() / 1000,
      },
      addLiquidityOptions: {
        tokenId: positionInfo.tokenId.toString(),
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

  public async closeAndBurnPosition(position: PositionInfo, recipient: string, deadline?: Date): Promise<Transaction>;

  public async closeAndBurnPosition(tokenId: bigint, recipient: string, deadline?: Date): Promise<Transaction>;

  public async closeAndBurnPosition(
    positionOrTokenId: PositionInfo | bigint,
    recipient: string,
    deadline?: Date,
  ): Promise<Transaction> {
    if (typeof positionOrTokenId === 'bigint') {
      positionOrTokenId = await this.getPositionByTokenId(positionOrTokenId);
    }

    const { fee0, fee1 } = await this.getFees(positionOrTokenId.tokenId);
    const [token0, token1] = await this.erc20Facade.getTokens([positionOrTokenId.token0, positionOrTokenId.token1]);

    const removeLiquidityOptions: RemoveLiquidityOptions = {
      deadline: deadline ? deadline.getTime() / 1000 : Math.floor(Date.now() / 1000 + 60 * 20),
      tokenId: positionOrTokenId.tokenId.toString(),
      slippageTolerance: new Percent(50, 10_000),
      liquidityPercentage: new Percent(1),
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
    const pool = new Pool(token0, token1, fee, slot0.sqrtPriceX96.toString(), liquidity.toString(), Number(slot0.tick));

    return pool;
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
}
