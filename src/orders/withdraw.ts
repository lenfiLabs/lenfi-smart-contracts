import {
  Data,
  getAddressDetails,
  Translucent,
  Tx,
} from "translucent-cardano";
import {
  calculateLpsToBurn,
  getPoolArtifacts,
  getValidityRange,
  OutputValue,
  toUnitOrLovelace,
  updateUserValue,
  ValidatorRefs,
} from "./../../src/util.ts";
import { ValidityRange } from "./../../src/types.ts";
import { OrderContractWithdrawOrderContract } from "./../../plutus.ts";

interface BatcherWithdrawArgs {
  amountToWithdraw: bigint; // Amount of tokens user want to withdraw (MUST BE NEGATIVE)
  poolTokenName: string;
}

export async function placeWithdrawalOrder(
  lucid: Translucent,
  tx: Tx,
  now: number,
  { amountToWithdraw, poolTokenName }: BatcherWithdrawArgs,
  { validators }: ValidatorRefs
) {
  const validityRange: ValidityRange = getValidityRange(lucid, now);

  const batcherAddress = lucid.utils.validatorToAddress(
    validators.orderContractWithdraw
  );

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );
  const poolDatumMapped = poolArtifacts.poolDatumMapped;

  const lpsToBurn = calculateLpsToBurn(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    amountToWithdraw,
    poolDatumMapped.totalLpTokens
  );

  const walletAddress = await lucid.wallet.address();
  const walletDetails = getAddressDetails(walletAddress);

  const batcherDatum: OrderContractWithdrawOrderContract["datum"] = {
    controlCredential: {
      VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
    },
    poolNftCs: {
      policyId: validators.poolScriptHash,
      assetName: poolTokenName,
    },
    batcherFeeAda: BigInt(2000000),
    order: {
      lpTokensBurn: BigInt(lpsToBurn),
      partialOutput: {
        address: {
          paymentCredential: {
            VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
          },
          stakeCredential: null,
        },
        value: new Map([["", new Map([["", BigInt(2000000)]])]]),
        datum: "NoDatum",
      },
      receiveAsset: {
        policyId: poolDatumMapped.params.loanCs.policyId,
        assetName: poolDatumMapped.params.loanCs.assetName,
      },
      lpAsset: {
        policyId: poolDatumMapped.params.lpToken.policyId,
        assetName: poolDatumMapped.params.lpToken.assetName,
      },
    },
  };

  const metadata = {
    msg: ["Lenfi: WITHDRAW order submitted."],
  };

  const depositValue = {
    [toUnitOrLovelace(
      poolDatumMapped.params.lpToken.policyId,
      poolDatumMapped.params.lpToken.assetName
    )]: BigInt(lpsToBurn),
  };

  let valueSendToBatcher: OutputValue = { lovelace: 4000000n };

  if (poolArtifacts.poolConfigDatum.poolFee > 0n) {
    const poolFee = {
      [toUnitOrLovelace(
        poolDatumMapped.params.loanCs.policyId,
        poolDatumMapped.params.loanCs.assetName
      )]: BigInt(poolArtifacts.poolConfigDatum.poolFee),
    };
    valueSendToBatcher = updateUserValue(valueSendToBatcher, poolFee);
  }

  // Add new value to the datum value
  valueSendToBatcher = updateUserValue(valueSendToBatcher, depositValue);

  const txBuilder = tx
    .payToContract(
      batcherAddress,
      {
        inline: Data.to(batcherDatum, OrderContractWithdrawOrderContract.datum),
      },
      valueSendToBatcher
    )
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata);

  return { txBuilder };
}
