import { Transaction } from './transaction';
import { Web3 } from 'web3';
import { uniswapMulticallAbi } from '../abis';

/**
 * Groups write transactions into a single multicall transaction **limited to targeting the same contract**.
 * The multicall itself is based on {@link https://github.com/Uniswap/v3-periphery/blob/main/contracts/base/Multicall.sol}
 */
export class MulticallTransaction extends Transaction {
  /**
   * Creates a new multicall transaction.
   * @param transactions The transactions to include in the multicall. All transactions must target the same contract.
   */
  constructor(transactions: Transaction[]) {
    MulticallTransaction.verifyTransactions(transactions);

    const web3 = new Web3();
    const contract = new web3.eth.Contract(uniswapMulticallAbi, transactions[0].getContractAddress());

    const calldata = contract.methods.multicall(transactions.map((t) => t.getRawTransaction().calldata)).encodeABI();

    super(calldata, 0n, transactions[0].getContractAddress());
  }

  private static verifyTransactions(transactions: Transaction[]) {
    if (transactions.length === 0) {
      throw new Error('No transactions provided for multicall');
    }

    const firstAddress = transactions[0].getContractAddress();

    for (let i = 1; i < transactions.length; i++) {
      if (transactions[i].getContractAddress() !== firstAddress) {
        throw new Error(
          `Detected different contract addresses in the transaction list for multicall, transactions[${0}] address: ${firstAddress}, transactions[${i}] address: ${transactions[
            i
          ].getContractAddress()}`,
        );
      }
    }
  }
}
