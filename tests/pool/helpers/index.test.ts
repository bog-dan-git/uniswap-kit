import { priceToTick, sqrt96ToPrice } from '../../../src/pool/helpers';

describe('Helpers', () => {
  it('Should convert price', () => {
    const result0 = sqrt96ToPrice(3250923441781767068775826n);
    const result1 = sqrt96ToPrice(3250903631890525897011144n);
    const result2 = sqrt96ToPrice(1937228754221455011665759441n);
    console.log('Result0 ' + result0);
    console.log('Result1 ' + result1);
    console.log('Result2 ' + result2);
    const tick0 = priceToTick(result0);
    const tick1 = priceToTick(result1);
    const tick2 = priceToTick(result2);
    console.log('Tick0 ' + tick0);
    console.log('Tick1 ' + tick1);
    console.log('Tick2 ' + tick2);
  });
  it('Should caclulate sqrt', () => {});
});
