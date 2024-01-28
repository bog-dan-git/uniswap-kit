import { PositionManager } from './positions/position-manager';
import { RPC_URL, WALLET_ADDRESS, WALLET_KEY, TOKEN0_ADDRESS, TOKEN1_ADDRESS } from '../tests/pool/utils';
import { UniswapPool } from './pool/uniswap-pool';
import { transactionMining } from '../tests/pool/utils/web3';

const main = async () => {
  const positionManager = await PositionManager.create('https://rpc.ankr.com/eth_goerli');
  const pool = await UniswapPool.fromTokens(RPC_URL, {
    token1Address: TOKEN0_ADDRESS,
    token2Address: TOKEN1_ADDRESS,
    fee: 500,
  });

  const activePositions = await pool.getActivePositions(WALLET_ADDRESS);
  const neededPosition = activePositions.find((x) => x.tokenId === 92852n);

  if (!neededPosition) {
    throw new Error('Position not found');
  }
  const tx = await positionManager.swapAndAddLiquidity(neededPosition!, {
    address: WALLET_ADDRESS,
    token0Amount: 2n * 10n ** 12n,
    token1Amount: 0n,
  });

  console.log('Got tx');

  const hash = await tx.execute({
    rpcUrl: RPC_URL,
    privateKey: WALLET_KEY,
  });

  await transactionMining(RPC_URL, hash.transactionHash.toString());
};

(async () => {
  await main();
})();
