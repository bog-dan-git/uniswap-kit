export interface UniswapConfig {
  deploymentAddresses: {
    uniswapV3Factory: string;
    quoter: string;
    swapRouter: string;
    quoterV2: string;
    swapRouter02: string;
    nonFungiblePositionManager: string;
  };
}

// see https://docs.uniswap.org/contracts/v3/reference/deployments
const mainAddresses: UniswapConfig = {
  deploymentAddresses: {
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    swapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    nonFungiblePositionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  },
};

// TODO: add all chains
export const uniswapConfigsByChainId: Record<number, UniswapConfig> = {
  1: mainAddresses,
  5: mainAddresses,
  10: mainAddresses,
  42161: mainAddresses,
};
