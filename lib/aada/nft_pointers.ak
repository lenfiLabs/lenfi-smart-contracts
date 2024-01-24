//// NFT Pointers
//// This module is for upgradable contracts. Already public.

use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{Input, Output}
use aiken/transaction/credential.{
  Address, Credential, Inline, StakeCredential, VerificationKey,
  VerificationKeyCredential,
}
use aiken/transaction/value.{quantity_of}

/// Similar to aada/utils.{authorized_by_credential}
fn cred_validator(
  validating_credential: Credential,
  withdrawals: Dict<StakeCredential, Int>,
  extra_signatories: List<Hash<Blake2b_224, VerificationKey>>,
) -> Bool {
  when validating_credential is {
    VerificationKeyCredential(pubkey_hash) ->
      extra_signatories |> list.any(fn(signatory) { signatory == pubkey_hash })
    script_credential -> withdrawals |> dict.has_key(Inline(script_credential))
  }
}

/// Find nft from reference, use its payment credential in cred_validator.
/// Where this is used, the script should fail if this returns false (but this function is pure)
pub fn nft_validator(
  nft_policy: ByteArray,
  // Gov NFT policy
  nft_name: ByteArray,
  // Gov NFT name
  reference_inputs: List<Input>,
  withdrawals: Dict<StakeCredential, Int>,
  extra_signatories: List<Hash<Blake2b_224, VerificationKey>>,
) -> Bool {
  when
    reference_inputs
      |> list.find(
           fn(inp) { quantity_of(inp.output.value, nft_policy, nft_name) == 1 },
         )
  is {
    Some(Input {
      output: Output { address: Address { payment_credential, .. }, .. },
      ..
    }) -> payment_credential |> cred_validator(withdrawals, extra_signatories)
    _ -> False
  }
}
