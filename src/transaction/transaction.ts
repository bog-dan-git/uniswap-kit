import { DEFAULT_RETURN_FORMAT, Web3 } from 'web3';

export interface TransactionExecutionParams {
  /**
   * RPC url to send transaction to (optional)
   */
  rpcUrl?: string;
  /**
   * Private key to sign transaction
   */
  privateKey: string;
  /**
   * Gas price to use for transaction (defaults to web3.eth.getGasPrice())
   */
  gasPrice?: bigint;
  /**
   * Gas to use for transaction (defaults to web3.eth.estimateGas())
   * NOTE! If you pass it, estimateGas() won't be called, so the revert won't be checked (and the transaction may fail).
   * Might be useful for debugging purposes.
   */
  gas?: bigint;
}

export class Transaction {
  constructor(
    private readonly calldata: string,
    private readonly value: bigint,
    private readonly contractAddress: string,
    private readonly rpcUrl?: string,
  ) {}

  public getContractAddress() {
    return this.contractAddress;
  }

  public getRawTransaction() {
    const { calldata, value } = this;

    return { calldata, value };
  }

  public async execute(params: TransactionExecutionParams) {
    const { privateKey, gasPrice } = params;
    const rpcUrl = params.rpcUrl || this.rpcUrl;

    if (!rpcUrl || !this.rpcUrl) {
      throw new Error('RPC url is required');
    }

    if (!privateKey) {
      throw new Error('Private key is required');
    }

    const web3 = new Web3(rpcUrl);
    const gasPriceToUse = gasPrice ?? (await web3.eth.getGasPrice());

    const account = web3.eth.accounts.privateKeyToAccount(privateKey);

    const transactionData = {
      to: this.contractAddress,
      from: account.address,
      value: this.value,
      data: this.calldata,
    };

    const gas = params.gas ?? (await web3.eth.estimateGas(transactionData));

    const signedTransaction = await account.signTransaction({ ...transactionData, gas, gasPrice: gasPriceToUse });

    return web3.eth.sendSignedTransaction(signedTransaction.rawTransaction, DEFAULT_RETURN_FORMAT, {
      // The revert is already checked during gas price estimation (if gas is not provided).
      // This allows forcing the transaction by providing gas value manually (for debugging purposes)
      checkRevertBeforeSending: false,
    });
  }
}
