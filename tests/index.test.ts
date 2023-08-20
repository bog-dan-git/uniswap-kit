import { helloWorld } from '../src';

describe('Hello, world', function () {
    it('Should return hello world', function () {
        const result = helloWorld();
        expect(result).toEqual('hello world');
    });
});
