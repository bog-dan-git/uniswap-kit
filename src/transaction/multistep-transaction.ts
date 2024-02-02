import { Transaction, TransactionExecutionParams } from './transaction';
import { TransactionReceipt, Web3 } from 'web3';

interface MultistepTransactionExecutionParams {
  rpcUrl?: string;
  internalParams?: Partial<TransactionExecutionParams>[];
  privateKey?: string;
  maxMiningTimeMs?: number;
}

const defaultMaxMiningTimeMs = 60000;

/**
 * Sequentially executes multiple transactions
 * Awaits mining of each transaction before executing the next one
 */
export class MultistepTransaction {
  public constructor(private readonly transactions: Transaction[]) {}

  public isMultistep(): this is MultistepTransaction {
    return true;
  }

  public async execute(params: MultistepTransactionExecutionParams): Promise<TransactionReceipt[]> {
    const transactionReceipts = [];

    for (const [index, transaction] of this.transactions.entries()) {
      const transactionParams = this.getTransactionParams(params, index);
      const transactionReceipt = await transaction.execute(transactionParams);
      await this.waitForMining(
        transactionParams.rpcUrl!,
        transactionReceipt,
        params.maxMiningTimeMs ?? defaultMaxMiningTimeMs,
      );
      transactionReceipts.push(transactionReceipt);
    }

    return transactionReceipts;
  }

  public getUnderlyingTransactions(): Transaction[] {
    return this.transactions;
  }

  private async waitForMining(rpcUrl: string, receipt: TransactionReceipt, maxWaitingTimeMs: number) {
    const web3 = new Web3(rpcUrl);
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        web3.eth
          .getTransactionReceipt(receipt.transactionHash)
          .then((receipt) => {
            if (receipt && receipt.blockNumber) {
              clearInterval(interval);
              resolve(receipt);
            }
          })
          .catch((e) => {
            clearInterval(interval);
            reject(e);
          });
      }, 500);

      setTimeout(() => {
        clearInterval(interval);
        reject(new Error('Transaction mining timeout'));
      }, maxWaitingTimeMs);
    });
  }

  private getTransactionParams(params: MultistepTransactionExecutionParams, index: number): TransactionExecutionParams {
    if (params.internalParams && params.internalParams[index]) {
      return {
        ...params.internalParams[index],
        privateKey: params.internalParams[index]?.privateKey
          ? params.internalParams[index].privateKey!
          : params.privateKey!,
        rpcUrl: params.internalParams[index]?.rpcUrl ? params.internalParams[index].rpcUrl! : params.rpcUrl,
      };
    }

    return {
      rpcUrl: params.rpcUrl!,
      privateKey: params.privateKey!,
    };
  }
}
