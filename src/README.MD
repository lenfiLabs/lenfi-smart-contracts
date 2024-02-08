### Off-chain code for the Aada client

This is Typescript offchain code that uses Lucid to generate and submit transactions.

It uses wallet from file (key.sk) while client will be using cardano wallet-api and wallet extensions.

For the client (batcher only)

## If contracts are not deployed (on chain for references):

`deno run -A deploy_validators.ts` Make sure to uncomment the needed validators.

## If oracles are expired:

`deno run -A oracle_update.ts {oracle_token_name}` Make sure to uncomment the needed validators.

## Create pool:

`deno run -A pool_create.ts 1000000`

## Deposit

### Batcher

`deno run -A batcher_deposit.ts 5000000 {pool_token_name}`

### Pool

`deno run -A pool_deposit.ts 5000000 {pool_token_name}` Where argument #2 is pool token name

## Withdraw

### Batcher

`deno run -A batcher_withdraw.ts -1000000 {pool_token_name}`

### Pool

`deno run -A pool_withdraw.ts -1000000 {pool_token_name}`

## Borrow

### Batcher

`deno run -A batcher_borrow.ts 1000000 2000000 {pool_token_name}`

### Pool

`deno run -A borrow_borrow.ts 1000000 2000000 {pool_token_name}`

Where:

- arg[0] - Loan amount
- arg[1] - Collateral amount

## Repay

### Batcher

`deno run -A batcher_repay.ts {pool_token_name} {loan_tx_hash}`

### Pool

`deno run -A pool_repay.ts {pool_token_name} {loan_tx_hash}`
