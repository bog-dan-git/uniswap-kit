import { TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';

export const priceToTick = (price: bigint): number => {
  const sqrtRatioX96 = priceToSqrt96(price);
  return TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtRatioX96.toString()));
};

export const tickToPrice = (tick: number): bigint => {
  return sqrt96ToPrice(BigInt(TickMath.getSqrtRatioAtTick(tick).toString()));
};

export const sqrt96ToPrice = (sqrtPriceX96: bigint): bigint => {
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** 36n) / 2n ** 192n;
};
// y = x^2 * 10 ** 36 / 2 ** 192
// x = sqrt(y * 2 ** 192 / 10 ** 36)
export const priceToSqrt96 = (price: bigint): bigint => {
  return sqrt((price * 2n ** 192n) / 10n ** 36n);
};

export const sqrt = (value: bigint): bigint => {
  if (value < 0n) {
    throw new Error('sqrt: negative input');
  }

  if (value < Number.MAX_SAFE_INTEGER) {
    return BigInt(Math.floor(Math.sqrt(Number(value))));
  }

  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (x + value / x) / 2n;
  }

  return z;
};
