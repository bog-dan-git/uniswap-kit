import { priceToTick, sqrt96ToPrice } from '../../../src/pool/helpers';
import { tickToPrice } from '@uniswap/v3-sdk';

describe('Helpers', () => {
  it('Should convert price', () => {
    tickToPrice();
    const result0 = tickToPrice(-23880);
    const result1 = tickToPrice(-21900);
    console.log(result0);
    console.log(result1);
  });
  it('Should caclulate sqrt', () => {});
});
