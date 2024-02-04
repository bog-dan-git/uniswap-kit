import { Percent } from '../models/percent';

export const DEFAULT_DEADLINE_SECONDS = 20 * 60;

export const DEFAULT_SLIPPAGE_TOLERANCE: Percent = {
  numerator: 5,
  denominator: 1000,
};
