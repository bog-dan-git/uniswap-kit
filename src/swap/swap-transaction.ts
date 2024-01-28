import { SwapConfig } from './swap-transaction.builder';

interface SwapTransactionParams {
  rpcUrl: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  recipient: string;
  swapConfig: SwapConfig;
}

export class SwapTransaction {
  constructor(private readonly swapTransactionParams: SwapTransactionParams) {}

  public async getTransaction() {}
}
