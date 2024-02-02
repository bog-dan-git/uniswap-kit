import { UniswapConfig, uniswapConfigByChainId } from '../config';
import { Web3 } from 'web3';
import { MulticallPlugin } from 'web3-plugin-multicall';

export class BaseUniService {
  private chainId: bigint | undefined;

  protected constructor(
    protected readonly rpcUrl: string,
    protected readonly config: UniswapConfig,
  ) {}

  protected static async validateConfig(rpcUrl: string, config?: UniswapConfig): Promise<UniswapConfig> {
    if (config) {
      return config;
    }

    const web3 = new Web3(rpcUrl);
    const chain = await web3.eth.getChainId();
    const configByChain = uniswapConfigByChainId[Number(chain)];

    if (!configByChain) {
      throw new Error(`Uniswap config for chainId ${chain} not found. Please, specify it manually`);
    }

    return configByChain;
  }

  protected getWeb3() {
    const web3 = new Web3(this.rpcUrl);
    web3.registerPlugin(new MulticallPlugin());

    return web3;
  }

  protected async getChainId() {
    if (this.chainId) {
      return this.chainId;
    }

    const web3 = this.getWeb3();
    const chain = await web3.eth.getChainId();

    this.chainId = chain;

    return chain;
  }
}
