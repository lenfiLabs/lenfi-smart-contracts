import {
  Address,
  PolicyId,
  Script,
  ScriptHash,
  UTxO,
  Validator,
} from "translucent-cardano"
import { PoolSpend } from "./../../plutus.ts"
import { OracleValidatorWithdrawValidate } from "./../plutus.ts"

export type AssetData = {
  txHash: string
  outputIndex: number
  assets: {
    [key: string]: bigint
  }
  address: string
  datumHash: string | undefined
  datum: string
  scriptRef: Script
}

export type OutputReference = {
  transactionId: { hash: string }
  outputIndex: bigint
}

export interface BlockfrostAssetsResponse {
  asset: string
  quantity: string
}

export interface BlockfrostAccountsResponse {
  stake_address: string
  active: boolean
  active_epoch: number
  controlled_amount: string
  rewards_sum: string
  withdrawals_sum: string
  reserves_sum: string
  treasury_sum: string
  withdrawable_amount: string
  pool_id: string
}

export interface PoolArtifacts {
  poolUTxO: UTxO
  configUTxO: UTxO
  poolDatumMapped: PoolSpend["datum"]
}

export interface LpTokenCalculation {
  depositAmount: bigint
  lpTokenMintAmount: bigint
}

export interface WithdrawDetails {
  withdrawAmount: number
  lpTokenBurnAmount: number
}

export interface ValidityRange {
  validFrom: number
  validTo: number
}

export interface TxObject {
  txHash: string
  outputIndex: number
  assets: { lovelace: bigint }
  address: string
  datumHash: string | undefined
  datum: string
  scriptRef: string | null
}

export type Asset = {
  policyId: string
  assetName: string
  amount: bigint
}

export interface TokenData {
  accepted_as_collateral: boolean
  accepted_as_loan: boolean
  decimals: number
  liquidation_threshold: number
  oracle_nft_id: string
  token_id: string
  token_nice_name: string
  token_policy: string
  token_name: string
  initial_collateral_ratio: number
}

export interface OracleDatum {
  poolScriptHash: string
  poolNftName: string
  oracleNftPolicyId: string
  oracleNftName: string
  tokenaAPolicyId: string
  tokenaAName: string
  tokenaBPolicyId: string
  tokenaBName: string
  tokenAAmount: bigint
  tokenBAmount: bigint
  expirationTime: bigint
}

export type lenfiNftAction = "MintR" | "BurnR"

export type DatumValue = {
  utxo: string
  datum: string // Seems to be a hex string, you might want to convert it into a human-readable form
}

export type PriceFeed =
  | {
    Aggregated: [
      {
        token: { policyId: string; assetName: string }
        tokenPriceInLovelaces: bigint
        denominator: bigint
        validTo: bigint
      },
    ]
  }
  | {
    Pooled: [
      {
        token: { policyId: string; assetName: string }
        tokenAAmount: bigint
        tokenBAmount: bigint
        validTo: bigint
      },
    ]
  }

export interface LoanDetails {
  loanUtxo: {
    txHash: string
    outputIndex: number
  }
  poolTokenName: string
  borrowerTokenName: string
  poolStakeValidator: Validator
  loanOracleValidator?: Validator
  collateralOracleValidator?: Validator
  loanOracleDetails?: OracleValidatorWithdrawValidate["redeemer"]
  collateralOracleDetails?: OracleValidatorWithdrawValidate["redeemer"]
}
