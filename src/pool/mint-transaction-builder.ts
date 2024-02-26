import { UniswapPool } from './uniswap-pool';
import {
  MintOptions,
  nearestUsableTick,
  NonfungiblePositionManager,
  PermitOptions,
  Pool,
  Position,
} from '@uniswap/v3-sdk';
import { priceToTick, sqrt96ToPrice } from './helpers';
import { MultistepTransaction, Transaction, TransactionResult } from '../transaction';
import { Percent as UniPercent } from '@uniswap/sdk-core';
import { Percent } from '../core/models/percent';
import { ERC20Facade } from '../erc20';
import { DEFAULT_DEADLINE_SECONDS } from '../core/settings';

interface BuildTransactionParams {
  recipient: string;
  deadline?: Date;
}

interface VerifyAllowanceOptions {
  token0?: boolean;
  token1?: boolean;
}

export class MintTransactionBuilder<T extends TransactionResult> {
  private amount0: bigint | undefined;
  private amount1: bigint | undefined;

  private tickLower: number | undefined;
  private tickUpper: number | undefined;

  private percentLower: Percent | undefined;
  private percentUpper: Percent | undefined;

  private priceLower: bigint | undefined;
  private priceUpper: bigint | undefined;

  private slippage = { numerator: 1, denominator: 1000 };
  private verifyAllowanceOptions: VerifyAllowanceOptions | undefined;
  private address: string | undefined;

  private token0Permit: PermitOptions | undefined;
  private token1Permit: PermitOptions | undefined;

  public constructor(
    private readonly pool: UniswapPool,
    private readonly erc20Facade: ERC20Facade,
  ) {}

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
   * @param address - address of the account to verify allowance (the account that will mint the position)
   * @param options - options for allowance verification. If not set, both tokens will be verified.
   * **NOTE** If token supports EIP-2612, it will be better to utilize `token0Permit` and `token1Permit` methods
   */
  public verifyAllowance(address: string, options?: VerifyAllowanceOptions) {
    this.address = address;
    this.verifyAllowanceOptions = options ?? { token0: true, token1: true };

    return this as MintTransactionBuilder<MultistepTransaction>;
  }

  public withToken0Permit(options: PermitOptions) {
    this.token0Permit = options;
  }

  public withToken1Permit(options: PermitOptions) {
    this.token1Permit = options;
  }

  public async buildTransaction({ recipient, deadline }: BuildTransactionParams): Promise<T> {
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

    const mintOptions: MintOptions = {
      recipient: recipient,
      deadline: deadline ? Math.floor(deadline.getTime() / 1000) : DEFAULT_DEADLINE_SECONDS,
      slippageTolerance: new UniPercent(this.slippage.numerator, this.slippage.denominator),
      token0Permit: this.token0Permit,
      token1Permit: this.token1Permit,
    };

    const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, mintOptions);

    const mintTransaction = new Transaction(
      calldata,
      BigInt(value),
      this.pool.config.deploymentAddresses.nonFungiblePositionManager,
    );

    if (this.verifyAllowanceOptions) {
      const transactions = [];

      const { amount0: amount0CurrencyAmount, amount1: amount1CurrencyAmount } = position.mintAmounts;
      const { token0, token1 } = position.pool;

      const amount0 = BigInt(amount0CurrencyAmount.toString());
      const amount1 = BigInt(amount1CurrencyAmount.toString());

      if (amount0 && this.verifyAllowanceOptions.token0) {
        if (!this.address) {
          throw new Error('Address is not set for allowance verification');
        }

        const tx = await this.erc20Facade.ensureApproved(
          token0.address,
          amount0,
          this.address,
          this.pool.config.deploymentAddresses.nonFungiblePositionManager,
        );

        if (tx) {
          transactions.push(tx);
        }
      }

      if (amount1 && this.verifyAllowanceOptions.token1) {
        if (!this.address) {
          throw new Error('Address is not set for allowance verification');
        }

        const tx = await this.erc20Facade.ensureApproved(
          token1.address,
          amount1,
          this.address,
          this.pool.config.deploymentAddresses.nonFungiblePositionManager,
        );

        if (tx) {
          transactions.push(tx);
        }
      }

      transactions.push(mintTransaction);

      return new MultistepTransaction(transactions) as T;
    }

    return mintTransaction as T;
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
