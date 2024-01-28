import { Token } from '@uniswap/sdk-core';
import { Web3 } from 'web3';
import { MulticallPlugin } from 'web3-plugin-multicall';
import { erc20Abi } from '../../abis';
import { Transaction } from '../../transaction';

export const getTokens = async (rpcUrl: string, addresses: string[]): Promise<Token[]> => {
  const web3 = new Web3(rpcUrl);
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
};

type ApproveTokenParams = {
  tokenAddress: string;
  spenderAddress: string;
  amount: bigint;
}[];

export const approveTokens = async (rpcUrl: string, tokens: ApproveTokenParams) => {
  const web3 = new Web3(rpcUrl);
  web3.registerPlugin(new MulticallPlugin());
  const result = [];
  for (const token of tokens) {
    const contract = new web3.eth.Contract(erc20Abi, token.tokenAddress);
    const method = contract.methods.approve(token.spenderAddress, token.amount).encodeABI();

    const transaction = new Transaction(method, '0x0', token.tokenAddress);

    result.push(transaction);
  }

  return result;
};
