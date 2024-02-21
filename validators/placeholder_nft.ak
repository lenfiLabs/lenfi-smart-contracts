use aada/nft.{NFTRedeemerElement, check_uniqueness}
use aiken/transaction.{Mint, ScriptContext, Transaction}

// This validator is used to mint unique NFTs that are later used as Delegation NFT or Protocol details NFT.
// Where _nonce is used to differentiate between the two policyIds
// Nonce = 1 - Delegation NFT
// Nonce = 2 - Protocol details NFT
validator(_nonce: Int) {
  fn placeholder_nft(r: NFTRedeemerElement<Void>, ctx: ScriptContext) {
    let ScriptContext { transaction: Transaction { inputs, mint, .. }, purpose } =
      ctx
    let NFTRedeemerElement { action, .. } = r
    expect Mint(own_purpose) = purpose
    check_uniqueness(action, inputs, mint, own_purpose)
  }
}
