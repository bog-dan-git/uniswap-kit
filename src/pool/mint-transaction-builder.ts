import { UniswapPool } from './uniswap-pool';
import { MintOptions, nearestUsableTick, NonfungiblePositionManager, Pool, Position } from '@uniswap/v3-sdk';
import { priceToTick, sqrt96ToPrice } from './helpers';
import { Transaction } from '../transaction';
import { Percent as UniPercent } from '@uniswap/sdk-core';
import { Percent } from '../core/models/percent';

interface BuildTransactionParams {
  recipient: string;
  deadline?: Date;
}

export class MintTransactionBuilder {
  private amount0: bigint | undefined;
  private amount1: bigint | undefined;

  private tickLower: number | undefined;
  private tickUpper: number | undefined;

  private percentLower: Percent | undefined;
  private percentUpper: Percent | undefined;

  private priceLower: bigint | undefined;
  private priceUpper: bigint | undefined;

  private slippage = { numerator: 1, denominator: 1000 };
  private shouldVerifyAllowance = false;

  public constructor(private readonly pool: UniswapPool) {}

  public fromAmount0(amount0: bigint): this {
    this.amount0 = amount0;

    return this;
  }

  public fromAmount1(amount1: bigint): this {
    this.amount1 = amount1;

    return this;
  }

  public fromAmounts({ amount0, amount1 }: { amount0: bigint; amount1: bigint }): this {
    this.amount0 = amount0;
    this.amount1 = amount1;

    return this;
  }

  public fromTicks({ tickLower, tickUpper }: { tickLower: number; tickUpper: number }): this {
    this.tickLower = tickLower;
    this.tickUpper = tickUpper;

    return this;
  }

  public fromPercents({ percentLower, percentUpper }: { percentLower: Percent; percentUpper: Percent }): this {
    this.percentLower = percentLower;
    this.percentUpper = percentUpper;

    return this;
  }

  public fromPrices({ priceLower, priceUpper }: { priceLower: bigint; priceUpper: bigint }): this {
    this.priceLower = priceLower;
    this.priceUpper = priceUpper;

    return this;
  }

  public withSlippage(slippage: Percent) {
    this.slippage = slippage;

    return this;
  }

  /**
   * Verifies ERC20 allowance for both tokens.
   * If allowance is not enough, it will be increased to the required value
   */
  public async verifyAllowance() {
    this.shouldVerifyAllowance = true;
  }

  public async buildTransaction({ recipient, deadline }: BuildTransactionParams) {
    if (!this.amount0 && !this.amount1) {
      throw new Error('Amounts are not set for mint transaction');
    }

    const poolData = await this.pool.getPoolMetadata();
    const poolTokens = await this.pool.getPoolTokens();

    const pool = new Pool(
      poolTokens.tokenA,
      poolTokens.tokenB,
      Number(poolData.fee),
      poolData.sqrtPriceX96.toString(),
      poolData.liquidity.toString(),
      Number(poolData.tick),
    );

    const ticks = await this.getTicks(pool);

    const position = await this.getPosition(pool, ticks);

    if (this.shouldVerifyAllowance) {
      // TODO: verify allowance
    }

    const mintOptions: MintOptions = {
      recipient: recipient,
      deadline: deadline ? Math.floor(deadline.getTime() / 1000) : Math.floor(Date.now() / 1000 + 60 * 20),
      slippageTolerance: new UniPercent(this.slippage.numerator, this.slippage.denominator),
    };

    const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, mintOptions);

    return new Transaction(calldata, value, this.pool.config.deploymentAddresses.nonFungiblePositionManager);
  }

  private async getTicks(pool: Pool) {
    if (this.tickLower !== undefined && this.tickUpper !== undefined) {
      return { tickLower: this.tickLower, tickUpper: this.tickUpper };
    }

    if (this.percentLower !== undefined && this.percentUpper !== undefined) {
      const price = sqrt96ToPrice(BigInt(pool.sqrtRatioX96.toString()));

      const upperPriceDiff = (price * BigInt(this.percentUpper.numerator)) / BigInt(this.percentUpper.denominator);
      const lowerPriceDiff = (price * BigInt(this.percentLower.numerator)) / BigInt(this.percentLower.denominator);

      const tickLower = priceToTick(price - lowerPriceDiff);
      const tickUpper = priceToTick(price + upperPriceDiff);

      return {
        tickLower: nearestUsableTick(tickLower, pool.tickSpacing),
        tickUpper: nearestUsableTick(tickUpper, pool.tickSpacing),
      };
    }

    if (this.priceLower !== undefined && this.priceUpper !== undefined) {
      const tickLower = priceToTick(this.priceLower);
      const tickUpper = priceToTick(this.priceUpper);

      return {
        tickLower: nearestUsableTick(tickLower, pool.tickSpacing),
        tickUpper: nearestUsableTick(tickUpper, pool.tickSpacing),
      };
    }

    throw new Error('No price range is set for current transaction');
  }

  private async getPosition(pool: Pool, ticks: { tickLower: number; tickUpper: number }) {
    if (this.amount0 !== undefined && this.amount1 !== undefined) {
      return Position.fromAmounts({
        pool,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        amount0: this.amount0.toString(),
        amount1: this.amount1.toString(),
        useFullPrecision: true,
      });
    }

    if (this.amount0 !== undefined) {
      return Position.fromAmount0({
        pool,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        amount0: this.amount0.toString(),
        useFullPrecision: true,
      });
    }

    if (this.amount1 !== undefined) {
      return Position.fromAmount1({
        pool,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        amount1: this.amount1.toString(),
      });
    }

    throw new Error('No amounts are set for current transaction');
  }
}
