use aiken/transaction/value.{AssetName, PolicyId}

/// Consider: wrapping this further for safety.
pub type POSIXTime =
  Int

/// There's got to be some functional way to do efficient checks on this.
/// Consider experimenting after testnet.
pub type AssetClass {
  policy_id: PolicyId,
  asset_name: AssetName,
}

pub type WrappedRedeemer<a> {
  BadScriptContext
  Wrapped(a)
}
