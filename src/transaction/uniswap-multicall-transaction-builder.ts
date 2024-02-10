import { Transaction } from './transaction';
import { Web3 } from 'web3';
import { uniswapMulticallAbi } from '../abis';

export class UniswapMulticallTransactionBuilder {
  constructor(private readonly transactions: Transaction[]) {}

  public build(): Transaction {
    this.verifyTransactions();

    const web3 = new Web3();
    const contract = new web3.eth.Contract(uniswapMulticallAbi, this.transactions[0].getContractAddress());

    const calldata = contract.methods
      .multicall(this.transactions.map((t) => t.getRawTransaction().calldata))
      .encodeABI();

    return new Transaction(calldata, 0n, this.transactions[0].getContractAddress());
  }

  private verifyTransactions() {
    const firstAddress = this.transactions[0].getContractAddress();

    for (let i = 1; i < this.transactions.length; i++) {
      if (this.transactions[i].getContractAddress() !== firstAddress) {
        throw new Error(
          `Detected different contract addresses in the transaction list for multicall, transactions[${0}] address: ${firstAddress}, transactions[${i}] address: ${this.transactions[
            i
          ].getContractAddress()}`,
        );
      }
    }
  }
}
