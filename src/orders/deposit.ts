import {
  Data,
  getAddressDetails,
  Translucent,
  Tx,
} from "translucent-cardano";
import {
  calculateLpTokens,
  getPoolArtifacts,
  getValidityRange,
  OutputValue,
  toUnitOrLovelace,
  updateUserValue,
  ValidatorRefs,
} from "./../../src/util.ts";
import { LpTokenCalculation, ValidityRange } from "./../../src/types.ts";
import { OrderContractDepositOrderContract } from "./../../plutus.ts";

interface BatcherDepositArgs {
  balanceToDeposit: bigint;
  poolTokenName: string;
}

export async function placeDepositOrder(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { balanceToDeposit, poolTokenName }: BatcherDepositArgs,
  { validators }: ValidatorRefs
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);

  const batcherAddress = lucid.utils.validatorToAddress(
    validators.orderContractDeposit
  );

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );
  const poolDatumMapped = poolArtifacts.poolDatumMapped;

  const lpTokensToDepositDetails: LpTokenCalculation = calculateLpTokens(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    balanceToDeposit,
    poolDatumMapped.totalLpTokens
  );

  const lpTokensToDeposit = lpTokensToDepositDetails.lpTokenMintAmount;

  poolDatumMapped.balance =
    poolDatumMapped.balance + lpTokensToDepositDetails.depositAmount;

  poolDatumMapped.totalLpTokens =
    poolDatumMapped.totalLpTokens + lpTokensToDeposit;

  const walletAddress = await lucid.wallet.address();
  const walletDetails = getAddressDetails(walletAddress);

  const batcherDatum: OrderContractDepositOrderContract["datum"] = {
    controlCredential: {
      VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
    },
    poolNftCs: {
      policyId: validators.poolScriptHash,
      assetName: poolTokenName,
    },
    batcherFeeAda: 2000000n,
    order: {
      depositAmount: BigInt(balanceToDeposit),
      partialOutput: {
        address: {
          paymentCredential: {
            VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
          },
          stakeCredential: null, // TODO: not good for normal wallets
        },
        value: new Map([["", new Map([["", BigInt(2000000)]])]]),
        datum: "NoDatum",
      },
      lpAsset: poolDatumMapped.params.lpToken,
    },
  };

  const metadata = {
    msg: ["Lenfi: DEPOSIT order submitted."],
  };

  const depositValue = {
    [toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    )]: BigInt(balanceToDeposit + poolArtifacts.poolConfigDatum.poolFee),
  };

  let valueSendToBatcher: OutputValue = { lovelace: 4000000n };

  // Add new value to the datum value
  valueSendToBatcher = updateUserValue(valueSendToBatcher, depositValue);

  const txBuilder = tx
    .payToContract(
      batcherAddress,
      {
        inline: Data.to(batcherDatum, OrderContractDepositOrderContract.datum),
      },
      valueSendToBatcher
    )
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata);

  return { txBuilder };
}
