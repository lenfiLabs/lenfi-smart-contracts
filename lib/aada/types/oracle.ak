use aada/types.{AssetClass}

// Tokens that have a lot of liquidity is in CEX
pub type AggregatedFeed {
  token: AssetClass,
  token_price_in_lovelaces: Int,
  denominator: Int,
  valid_to: Int,
}

// Tokens that have lower liquidity and pool data is used to calculate the price
pub type PooledFeed {
  token: AssetClass,
  token_a_amount: Int,
  token_b_amount: Int,
  valid_to: Int,
}

pub type OraclePriceFeed {
  Aggregated(AggregatedFeed)
  Pooled(PooledFeed)
}

pub type Signature {
  signature: ByteArray,
  key_position: Int,
}

pub type OracleRedeemer {
  data: OraclePriceFeed,
  signatures: List<Signature>,
}
