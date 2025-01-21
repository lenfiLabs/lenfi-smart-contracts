use aada/nft.{NFTRedeemerElement, check_uniqueness}
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, Transaction}

// This validator is used to mint unique NFTs that are later used as Delegation NFT or Protocol details NFT.
// Where _nonce is used to differentiate between the two policyIds
// Nonce = 1 - Delegation NFT
// Nonce = 2 - Protocol details NFT
validator placeholder_nftv(_nonce: Int) {
  mint(
    r: NFTRedeemerElement<Void>,
    transaction: Transaction,
    own_policy: PolicyId,
  ) {
    let Transaction { inputs, mint, .. } = transaction
    let NFTRedeemerElement { action, .. } = r
    check_uniqueness(action, inputs, mint, own_policy)
  }

  else(_) {
    fail
  }
}
