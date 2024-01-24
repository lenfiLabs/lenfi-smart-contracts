import {
  Data,
  getAddressDetails,
  stakeCredentialOf,
  toUnit,
  Translucent,
  Tx,
  TxHash,
  UTxO,
} from "translucent-cardano";
import {
  aggregateDeposits,
  calculateInterestAmount,
  getPoolArtifacts,
  getValidityRange,
  MIN_ADA,
  OutputValue,
  toUnitOrLovelace,
  updateUserValue,
  ValidatorRefs,
} from "./../../src/util.ts";
import { Asset, LoanDetails, ValidityRange } from "./../../src/types.ts";
import {
  CollateralSpend,
  OrderContractRepayOrderContract,
} from "./../../plutus.ts";

interface BatcherRepayArgs {
  poolTokenName: string;
  txHash?: TxHash; // Transaction hash of the UTXO sitting in the collateral contract
  outputIndex?: number; // Output index of the UTXO sitting in the collateral contract
}

export async function placeRepayOrder(
  lucid: Translucent,
  tx: Tx,
  now: number,
  loanDetails: LoanDetails[],
  { validators }: ValidatorRefs
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);
  const utxoToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
    {
      txHash: loanDetails[0].loanUtxo.txHash,
      outputIndex: loanDetails[0].loanUtxo.outputIndex,
    },
  ]);

  const batcherAddress = lucid.utils.validatorToAddress(
    validators.orderContractRepay
  );

  if (!utxoToConsumeCollateral[0].datum) {
    throw new Error("UTXO does not have a datum");
  }

  const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
    utxoToConsumeCollateral[0],
    CollateralSpend.datum
  );

  const poolArtifacts = await getPoolArtifacts(
    loanDetails[0].poolTokenName,
    validators,
    lucid
  );

  const walletAddress = await lucid.wallet.address();
  const walletDetails = getAddressDetails(walletAddress);

  const acumulatedInterest = calculateInterestAmount(
    collateralDatumMapped.interestRate,
    collateralDatumMapped.loanAmount,
    collateralDatumMapped.depositTime,
    validityRange.validTo + 600 * 1000 // 10 minutes, to account for the batcher submitting 10 mins later
  );

  const loanPlusInterest =
    collateralDatumMapped.loanAmount + acumulatedInterest;

  const outputValues: Asset[] = [
    {
      policyId: "",
      assetName: "",
      amount: MIN_ADA,
    },
    {
      policyId: poolArtifacts.poolDatumMapped.params.collateralCs.policyId,
      assetName: poolArtifacts.poolDatumMapped.params.collateralCs.assetName,
      amount: BigInt(collateralDatumMapped.collateralAmount),
    },
  ];

  const outputMap = aggregateDeposits(outputValues);

  const batcherDatum: OrderContractRepayOrderContract["datum"] = {
    controlCredential: {
      VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
    },
    poolNftCs: {
      policyId: validators.poolScriptHash,
      assetName: loanDetails[0].poolTokenName,
    },
    batcherFeeAda: 10n,
    order: {
      expectedOutput: {
        address: {
          paymentCredential: {
            VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
          },
          stakeCredential: null,
        },
        value: outputMap,
        datum: "NoDatum",
        referenceScript: null,
      },
      order: {
        transactionId: { hash: utxoToConsumeCollateral[0].txHash },
        outputIndex: BigInt(utxoToConsumeCollateral[0].outputIndex),
      },
      burnAsset: {
        policyId: validators.collateralValidatorHash,
        assetName: collateralDatumMapped.borrowerTn,
      },
    },
  };

  const metadata = {
    msg: ["Lenfi: REPAY order submitted."],
  };

  const depositValue = {
    [toUnitOrLovelace(
      collateralDatumMapped.loanCs.policyId,
      collateralDatumMapped.loanCs.assetName
    )]: BigInt(loanPlusInterest),
    [toUnit(
      validators.collateralValidatorHash,
      collateralDatumMapped.borrowerTn
    )]: 1n,
  };

  let valueSendToBatcher: OutputValue = { lovelace: 4000000n };

  if (poolArtifacts.poolConfigDatum.poolFee > 0n) {
    const poolFee = {
      [toUnitOrLovelace(
        poolArtifacts.poolDatumMapped.params.loanCs.policyId,
        poolArtifacts.poolDatumMapped.params.loanCs.assetName
      )]: BigInt(poolArtifacts.poolConfigDatum.poolFee),
    };
    valueSendToBatcher = updateUserValue(valueSendToBatcher, poolFee);
  }

  // Add new value to the datum value
  valueSendToBatcher = updateUserValue(valueSendToBatcher, depositValue);

  const txBuilder = tx
    .payToContract(
      batcherAddress,
      { inline: Data.to(batcherDatum, OrderContractRepayOrderContract.datum) },
      valueSendToBatcher
    )
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata);

  return { txBuilder };
}
