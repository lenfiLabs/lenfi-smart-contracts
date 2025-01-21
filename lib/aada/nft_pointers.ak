//// NFT Pointers
//// This module is for upgradable contracts. Already public.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{
  Blake2b_224, DataHash, Hash, ScriptHash, VerificationKeyHash, blake2b_256,
}
use cardano/address.{
  Address, Credential, Inline, StakeCredential, VerificationKey,
}
use cardano/assets.{Lovelace, quantity_of}
use cardano/transaction.{Input, Output}

/// Similar to aada/utils.{authorized_by_credential}
fn cred_validator(
  validating_credential: Credential,
  withdrawals: Pairs<Credential, Lovelace>,
  extra_signatories: List<VerificationKeyHash>,
) -> Bool {
  when validating_credential is {
    VerificationKey(pubkey_hash) ->
      extra_signatories |> list.any(fn(signatory) { signatory == pubkey_hash })
    script_credential -> withdrawals |> pairs.has_key(script_credential)
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
  withdrawals: Pairs<Credential, Lovelace>,
  extra_signatories: List<VerificationKeyHash>,
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
