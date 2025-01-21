use aada/utils
use aiken/builtin
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/assets.{Value}
use cardano/transaction.{Input, OutputReference}

pub type NFTAction {
  // Consumed oref, Index of produced output
  MintNFT(OutputReference, Int)
  // Name of token to burn
  BurnNFT(ByteArray)
}

pub type NFTRedeemerElement<a> {
  action: NFTAction,
  inner: a,
}

pub type NFTRedeemer<a> =
  List<NFTRedeemerElement<a>>

pub type MintNFTElem {
  output_reference: OutputReference,
  output_pointer: Int,
}

pub type BurnNFTElem {
  token_name: ByteArray,
}

pub type CollateralNFTRedeemerLists {
  mints: List<MintNFTElem>,
  burns: Pairs<BurnNFTElem>,
}

pub fn id_from_utxo(consumed_utxo: OutputReference) -> ByteArray {
  blake2b_256(builtin.serialise_data(consumed_utxo))
}

pub fn check_uniqueness(
  nft_action: NFTAction,
  inputs: List<Input>,
  mint: Value,
  own_policy: ByteArray,
) -> Bool {
  when nft_action is {
    MintNFT(consumed_utxo, _) -> {
      let nft_name = id_from_utxo(consumed_utxo)
      utils.validate_mint_nft(mint, own_policy, nft_name, 1) && list.any(
        inputs,
        fn(input) { input.output_reference == consumed_utxo },
      )
    }
    BurnNFT(nft_name) -> utils.validate_mint_nft(mint, own_policy, nft_name, -1)
  }
}
