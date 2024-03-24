# Overview

Let's be real, V3 AMMs can be tough to grasp and even tougher to master.
While the Uniswap SDK does a stellar job guiding you through, sometimes you just want to swap tokens or play with
liquidity without needing a DeFi doctorate.
This package aims to simplify interactions as much as possible while still accommodating advanced use cases.

Currently, the package offers support for:

- 🔄 Token swapping
- 🏦 Minting positions
- 🔥 Burning positions
- 💧 Adding liquidity (including swapping and adding liquidity in a single transaction)
- 🗑️ Removing liquidity
- 💰 Fetching token prices
- 🏊 Fetching liquidity pool data
- 📈 Retrieving position data

Additionally, it includes:

- 💸 A built-in transaction executor (say goodbye to worrying about gas fees). If you don't like it though, you can
  always get the raw calldata and execute it yourself.
- 📊 Auto-approve tokens for spending (including EIP-2612 permit-based approvals where applicable). Again, you are not
  obliged to use it
- 🔄 Multicall support (for minting/burning multiple positions at once)

And the best part? It uses multicalls for querying data, keeping those RPC provider bills low. 📉

# Examples

## Swapping tokens

```typescript
const swapManager = await SwapManager.create(RPC_URL);

const transaction = await swapManager.swapExactInput({
  tokenInAddress: TOKEN0_ADDRESS, 
  tokenOutAddress: TOKEN1_ADDRESS, 
  amountIn,
  slippage: { numerator: 1, denominator: 100 }, // 1% slippage
  ensureAllowance: false, // if set to true, the additional transaction will be added
  recipient: WALLET_ADDRESS,
});

await transaction.execute({
  rpcUrl: RPC_URL, privateKey: WALLET_KEY,
}); // in this case the transaction will be executed automatically

// OR

const { calldata, value } = transaction.getRawTransaction();
// execute it however you like later
```

## Minting position

```typescript
const pool = await Pool.fromAddress(RPC_URL, POOL_ADDRESS);

const transaction = await pool
  .createMintTransaction()
  .fromPercents({
    percentLower: {
      numerator: 1, 
      denominator: 10,
    }, 
    percentUpper: {
      numerator: 1, 
      denominator: 10,
    },
  }) // liquidity concentrated in a 10% from current price, all the calculations are perfomed automatically
  .fromAmount0(10n ** 6n) // assuming infinte amount of token1
  .buildTransaction({
    recipient: WALLET_ADDRESS,
  });

await transaction.execute({ rpcUrl: RPC_URL, privateKey: WALLET_KEY });
```

## Burning position (and removing liquidity)

```typescript
const positionManager = await PositionManager.create(RPC_URL);
const transaction = await positionManager.closeAndBurnPosition(positionTokenId, WALLET_ADDRESS);

await transaction.execute({ rpcUrl: RPC_URL, privateKey: WALLET_KEY });
``` 

Please note that while the examples provided above are complete, they represent only a fraction of the functionality offered by the library. 🚧 Additionally, the library itself, along with full documentation, is a work in progress. 🌟 Users are encouraged to explore the codebase, discover additional features, and contribute to its development. 🛠️
