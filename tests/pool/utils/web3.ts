import { Web3 } from 'web3';

export const transactionMining = (rpcUrl: string, hash: string) => {
  return new Promise((resolve, reject) => {
    const web3 = new Web3(rpcUrl);

    const interval = setInterval(() => {
      web3.eth
        .getTransactionReceipt(hash)
        .then((receipt) => {
          if (receipt && receipt.blockNumber) {
            clearInterval(interval);
            resolve(receipt);
          }
        })
        .catch((e) => reject(e));
    }, 500);
  });
};
