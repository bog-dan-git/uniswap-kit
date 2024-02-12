import Web3 from 'web3';
import { erc20Abi } from '../abis';
import { Transaction } from '../transaction';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { Token } from '@uniswap/sdk-core';

export class ERC20Facade {
  constructor(private readonly rpcUrl: string) {}

  public async allowance(tokenAddress: string, owner: string, spender: string): Promise<bigint> {
    const web3 = new Web3(this.rpcUrl);
    const token = new web3.eth.Contract(erc20Abi, tokenAddress);
    const result = await token.methods.allowance(owner, spender).call();

    return BigInt(result);
  }

  public async approve(tokenAddress: string, spender: string, amount: bigint): Promise<Transaction> {
    const web3 = new Web3(this.rpcUrl);
    const token = new web3.eth.Contract(erc20Abi, tokenAddress);
    const abi = token.methods.approve(spender, amount.toString()).encodeABI();

    return new Transaction(abi, 0n, tokenAddress, this.rpcUrl);
  }

  public async getTokens(addresses: string[]): Promise<Token[]> {
    const web3 = new Web3(this.rpcUrl);
    web3.registerPlugin(new MulticallPlugin());
    const chainId = await web3.eth.getChainId();
    const tokenContracts = addresses.map((address) => new web3.eth.Contract(erc20Abi, address));
    const tokensData = await web3.multicall.makeMulticall(
      tokenContracts
        .map((contract) => [contract.methods.decimals(), contract.methods.symbol(), contract.methods.name()])
        .flat(),
    );

    const tokens = addresses.map((address, i) => {
      const [decimals, symbol, name] = tokensData.slice(i * 3, i * 3 + 3);
      return new Token(Number(chainId), address, Number(decimals), symbol.toString(), name.toString());
    });

    return tokens;
  }

  public async ensureApproved(
    tokenAddress: string,
    amount: bigint,
    address: string,
    spender: string,
  ): Promise<Transaction | undefined> {
    const allowance = await this.allowance(tokenAddress, address, spender);

    if (allowance < amount) {
      return this.approve(tokenAddress, spender, amount);
    }
  }
}
