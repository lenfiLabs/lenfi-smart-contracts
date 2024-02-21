//// Utils 

use aada/types.{AssetClass}
use aada/types/oracle.{Aggregated, OraclePriceFeed, OracleRedeemer, Pooled}
use aiken/dict
use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/math/rational.{Rational, mul, reciprocal}
use aiken/option
use aiken/transaction.{
  InlineDatum, Input, Output, Redeemer, ScriptPurpose, WithdrawFrom,
}
use aiken/transaction/credential.{
  Address, Credential, Inline, StakeCredential, VerificationKey,
  VerificationKeyCredential,
}
use aiken/transaction/value.{
  AssetName, MintedValue, PolicyId, from_minted_value, quantity_of,
}

/// These are aada/plutus specific utility functions. They mostly take ctx/inputs/other transaction data.
/// Other utils can be found in finance
/// Stores script hashes in a lock-forever token, replaces some script params and avoids circular imports
pub type ReferenceTokenDatum {
  delegator_nft_policy: PolicyId,
  liquidations_pkh: ByteArray,
  pool_script_hash: ByteArray,
  pool_config_script_hash: ByteArray,
  merge_script_hash: ByteArray,
}

pub fn get_ref_token_datum(
  ref_inputs: List<Input>,
  ref_token: AssetClass,
) -> Option<ReferenceTokenDatum> {
  list.find(
    ref_inputs,
    fn(input) {
      quantity_of(input.output.value, ref_token.policy_id, ref_token.asset_name) == 1
    },
  )
    |> option.and_then(
         fn(input) {
           expect InlineDatum(datum) = input.output.datum
           expect datum_typed: ReferenceTokenDatum = datum
           Some(datum_typed)
         },
       )
}

/// Checks that an NFT, and only that NFT, was minted from policy.
pub fn validate_mint_nft(
  mints: MintedValue,
  expected_minting_policy: ByteArray,
  expected_minting_name: ByteArray,
  expected_minting_amt: Int,
) -> Bool {
  let mints_policy =
    dict.to_list(
      value.tokens(from_minted_value(mints), expected_minting_policy),
    )
  mints_policy == [(expected_minting_name, expected_minting_amt)]
}

pub fn validate_mint_nft_few_per_policy(
  mints: MintedValue,
  expected_minting_policy: ByteArray,
  expected_minting_name: ByteArray,
  expected_minting_amt: Int,
) -> Bool {
  let mints_policy =
    dict.to_list(
      value.tokens(from_minted_value(mints), expected_minting_policy),
    )
  list.has(mints_policy, (expected_minting_name, expected_minting_amt))
}

/// Checks an output has a minimum quantity and is also at an address
pub fn output_has_quantity_with_address(
  output: Output,
  address: Address,
  policy_id: PolicyId,
  token_name: AssetName,
  amount: Int,
) {
  let Output { address: output_address, value: output_value, .. } = output
  output_address == address && quantity_of(output_value, policy_id, token_name) >= amount
}

/// Runs calculations using oracle feeds (datums).
/// Automatically flips the order if e.g your fetching ADA/USD from a USD/ADA oracle or vice versa.
/// Get outputs that contains any token of given policy and name
pub fn get_outputs_by_nft(
  outputs: List<Output>,
  token_policy: PolicyId,
  token_name: AssetName,
) -> List<Output> {
  list.filter(
    outputs,
    fn(output) { quantity_of(output.value, token_policy, token_name) > 0 },
  )
}

/// Get inputs that contains exactly 1 token of given policy and name
pub fn get_input_by_nft(
  inputs: List<Input>,
  token_policy: PolicyId,
  token_name: AssetName,
) -> Input {
  expect Some(x) =
    list.find(
      inputs,
      fn(input) {
        quantity_of(input.output.value, token_policy, token_name) == 1
      },
    )
  x
}

/// Transaction authorized by credential.
/// If verification key, check it is contained within extra_signatories
/// If script, check it is in stake withdrawals (programmable by stake scripts)
pub fn authorized_by_credential(
  extra_signatories: List<Hash<Blake2b_224, VerificationKey>>,
  withdrawals: dict.Dict<StakeCredential, Int>,
  payment_key: Credential,
) -> Bool {
  when payment_key is {
    // either credential is a spending key, or script using stake-withdraw-0
    VerificationKeyCredential(payment_key_hash) ->
      list.has(extra_signatories, payment_key_hash)
    script_credential -> dict.has_key(withdrawals, Inline(script_credential))
  }
}

// Used to circumvent a strange codegen bug that doesn't work with the standard rational div -- possibly something to do with piping generics?
pub fn safe_div(left: Rational, right: Rational) -> Option<Rational> {
  when reciprocal(right) is {
    Some(rat) -> Some(mul(left, rat))
    None -> None
  }
}

pub fn retrieve_oracle_data(
  inputs: List<Input>,
  oracle_asset: AssetClass,
  redeemers: dict.Dict<ScriptPurpose, Redeemer>,
  transaction_valid_to: Int,
) -> Option<OraclePriceFeed> {
  let oracle_loan_input =
    get_input_by_nft(inputs, oracle_asset.policy_id, oracle_asset.asset_name)

  expect Some(loan_oracle_redeemer) =
    dict.get(
      redeemers,
      WithdrawFrom(Inline(oracle_loan_input.output.address.payment_credential)),
    )

  expect loan_tokens_price: OracleRedeemer = loan_oracle_redeemer

  when loan_tokens_price.data is {
    Pooled(data) ->
      if data.valid_to >= transaction_valid_to {
        Some(Pooled(data))
      } else {
        trace @"oracle is expired"
        None
      }
    Aggregated(data) ->
      if data.valid_to >= transaction_valid_to {
        Some(Aggregated(data))
      } else {
        trace @"oracle is expired"

        None
      }
  }
}
