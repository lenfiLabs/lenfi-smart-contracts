import { Emulator, Translucent, Validator } from "translucent-cardano";
import {
  borrowFromPool,
  createPool,
  CreatePoolResult,
  deletePool,
  depositIntoPool,
  mergeToPool,
  poolLiquidate,
  poolLiquidateMerge,
  repayLoan,
  repayLoanToMege,
  updateConfig,
  withdrawFromPool,
  withdrawPoolRewards,
} from "./../../src/pool/mod.ts";
import {
  AssetClass,
  createMockOracle,
  generateAccount,
  GeneratedAccount,
  LENFI_POLICY_ID,
  LENFI_TOKEN_NAME,
  MIN_POLICY_ID,
  MIN_TOKEN_NAME,
  quickSubmitBuilder,
} from "./../pool/utils.ts";
import { deployValidators } from "./../../src/deploy_validators.ts";
import {
  collectValidators,
  DeployedValidators,
  toUnitOrLovelace,
  Validators,
} from "./../../src/util.ts";
import { defaultConfig, defaultProtocolParams } from "./../../src/constants.ts";
import { OracleValidatorWithdrawValidate } from "./../../plutus.ts";
import { LoanDetails } from "./../../src/types.ts";
import { createGovernanceNFT } from "./../../src/pool/create_governance_nft.ts";
import { signedOracleFeed } from "./oracle/oracle_feeds.ts";
import { createDepositBorrow } from "../../src/pool/createDepositBorrow.ts";
import { updateOracle } from "../../src/pool/update_oracle.ts";
import { claimLiquidated } from "../../src/pool/claim_liquidated.ts";

function testTokenScenario(
  poolName: string,
  { policy: loanTokenPolicy, name: loanTokenName }: AssetClass, // loan
  { policy: collateralTokenPolicy, name: collateralTokenName }: AssetClass, //collateral
  loanAmount: bigint,
  collateralAmount: bigint,
  loanOracle?: OracleValidatorWithdrawValidate["redeemer"],
  loanOracleForLiquidatinon?: OracleValidatorWithdrawValidate["redeemer"],
  loanOracleForPartialLiquidatinon?: OracleValidatorWithdrawValidate["redeemer"],
  collateralOracle?: OracleValidatorWithdrawValidate["redeemer"],
  collateralOracleForLiquidatinon?: OracleValidatorWithdrawValidate["redeemer"],
  collateralOracleForPartialLiquidatinon?: OracleValidatorWithdrawValidate["redeemer"],
  expiredLoanOracle?: OracleValidatorWithdrawValidate["redeemer"],
  expiredCollateralOracle?: OracleValidatorWithdrawValidate["redeemer"]
) {
  const loanTokenUnit = toUnitOrLovelace(loanTokenPolicy, loanTokenName);
  const collateralTokenUnit = toUnitOrLovelace(
    collateralTokenPolicy,
    collateralTokenName
  );

  describe(`Pool Tests: ${poolName}`, () => {
    let ACCOUNT_0: GeneratedAccount;
    let emulator: Emulator;
    let lucid: Translucent;
    let validators: Validators;
    let deployedValidators: DeployedValidators;

    beforeEach(async () => {
      ACCOUNT_0 = await generateAccount({
        [collateralTokenUnit]: 200000000000000000n,
        [loanTokenUnit]: 200000000000000000n,
        lovelace: 2000000000000000000n,
      });

      emulator = new Emulator([ACCOUNT_0], defaultProtocolParams);
      lucid = await Translucent.new(emulator);
      emulator.awaitBlock(10_000); // For validity ranges to be valid
      lucid.selectWalletFromPrivateKey(ACCOUNT_0.privateKey);

      // Create governance NFT
      const govNftResults = await createGovernanceNFT(lucid, lucid.newTx());

      await quickSubmitBuilder(emulator)({
        txBuilder: govNftResults.txBuilder,
      });

      validators = collectValidators(
        lucid,
        defaultConfig,
        "",
        govNftResults.governanceNFTName
      );

      deployedValidators = await deployValidators(lucid, {
        writeToFile: false,
        validators,
      });

      emulator.awaitBlock(1);
    });

    describe("Create/Deposit/Borrow in the same Transaction", () => {
      let loanTokenOracleNft: string;
      let collateralTokenOracleNft: string;
      let loanOracleValidator: Validator;
      let collateralOracleValidator: Validator;
      let creationResultPool: CreatePoolResult;
      let creationResultPool2: CreatePoolResult;
      it("should create Pool/Deposit/Borrow in one transaction", async () => {
        if (loanTokenUnit !== "lovelace") {
          const oracleResult = await createMockOracle(
            lucid,
            lucid.newTx(),
            0n,
            {
              validators,
              deployedValidators,
            }
          );

          loanTokenOracleNft = oracleResult.oracleNft;
          loanOracleValidator = oracleResult.oracleValidator;

          await quickSubmitBuilder(emulator)({
            txBuilder: oracleResult.txBuilder,
          });
        }

        if (collateralTokenUnit !== "lovelace") {
          const oracleResult = await createMockOracle(
            lucid,
            lucid.newTx(),
            0n,
            {
              validators,
              deployedValidators,
            }
          );

          collateralTokenOracleNft = oracleResult.oracleNft;
          collateralOracleValidator = oracleResult.oracleValidator;

          await quickSubmitBuilder(emulator)({
            txBuilder: oracleResult.txBuilder,
          });
        }

        creationResultPool = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 200000000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: collateralTokenOracleNft,
            loanOracleNft: loanTokenOracleNft,
          },
          {
            validators,
            deployedValidators,
          }
        );

        await quickSubmitBuilder(emulator)({
          txBuilder: creationResultPool.txBuilder,
        });

        creationResultPool2 = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 200000000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: collateralTokenOracleNft,
            loanOracleNft: loanTokenOracleNft,
          },
          {
            validators,
            deployedValidators,
          },
          false
        );

        await quickSubmitBuilder(emulator)({
          txBuilder: creationResultPool2.txBuilder,
        });

        const multiActionResult = await createDepositBorrow(
          lucid,
          lucid.newTx(),
          0n,
          emulator.now(),
          {
            loanAmount: loanAmount,
            collateralAmount: collateralAmount,
            poolTokenName: creationResultPool.poolId,
            poolStakeValidator: creationResultPool.stakingValidator,
            poolTokenName2: creationResultPool2.poolId,
            poolStakeValidator2: creationResultPool2.stakingValidator,
            collateralOracleValidator,
            loanOracleValidator,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          },
          { validators, deployedValidators }
        );

        await quickSubmitBuilder(emulator)({
          txBuilder: multiActionResult.txBuilder,
        });
      });
    });

    describe("Pool Creation", () => {
      it("should create pool successfully", async () => {
        const poolCreationResult = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 9000999000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: "",
            loanOracleNft: "",
          },
          {
            validators,
            deployedValidators,
          }
        );
        await quickSubmitBuilder(emulator)({
          txBuilder: poolCreationResult.txBuilder,
        });
      });

      it("should create and then delete a pool successfully", async () => {
        const poolCreationResult = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 90000000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: "",
            loanOracleNft: "",
          },
          {
            validators,
            deployedValidators,
          }
        );
        await quickSubmitBuilder(emulator)({
          txBuilder: poolCreationResult.txBuilder,
        });

        // Now delete the pool
        const poolTokenName = poolCreationResult.poolId;
        await deletePool(
          lucid,
          lucid.newTx(),
          {
            poolTokenName,
          },
          { validators, deployedValidators },
          poolCreationResult.lpTokenPolicy
        ).then(quickSubmitBuilder(emulator));
      });
    });

    describe("Pool lifecycle", () => {
      let creationResult: CreatePoolResult;
      let loanOracleValidator: Validator;
      let loanTokenOracleNft: string;
      beforeEach(async () => {
        if (loanTokenUnit !== "lovelace") {
          const oracleResult = await createMockOracle(
            lucid,
            lucid.newTx(),
            0n,
            {
              validators,
              deployedValidators,
            }
          );

          loanTokenOracleNft = oracleResult.oracleNft;
          loanOracleValidator = oracleResult.oracleValidator;

          await quickSubmitBuilder(emulator)({
            txBuilder: oracleResult.txBuilder,
          });
        }

        creationResult = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 90000000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: "",
            loanOracleNft: loanTokenOracleNft,
          },
          {
            validators,
            deployedValidators,
          }
        );
        await quickSubmitBuilder(emulator)({
          txBuilder: creationResult.txBuilder,
        });
        emulator.distributeRewards(100000000n);
      });

      it("Should deposit succesfully", async () => {
        await depositIntoPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            balanceToDeposit: 500n * 10000000n,
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should not deposit: minting too much LP", async () => {
        try {
          await depositIntoPool(
            lucid,
            lucid.newTx(),
            0n,
            {
              balanceToDeposit: 500n * 10000000n,
              poolTokenName: creationResult.poolId,
              poolStakeValidator: creationResult.stakingValidator,
            },
            { validators, deployedValidators },
            500n
          ).then(quickSubmitBuilder(emulator));
        } catch (e) {
          expect(e).toContain("check_delta_amount ? False");
        }
      });
      it("Should deposit: minting fewer LP", async () => {
        await depositIntoPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            balanceToDeposit: 500n * 10000000n,
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators },
          -500n
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should withdraw succesfully", async () => {
        await withdrawFromPool(
          lucid,
          lucid.newTx(),
          0n,
          emulator.now(),
          {
            amountToWithdraw: 500n * 100000n,
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should not withdraw: Withdrawing more than allowed", async () => {
        try {
          await withdrawFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              amountToWithdraw: 500n * 100000n,
              poolTokenName: creationResult.poolId,
              poolStakeValidator: creationResult.stakingValidator,
            },
            { validators, deployedValidators },
            500n
          ).then(quickSubmitBuilder(emulator));
        } catch (e) {
          expect(e).toContain("check_delta_amount ? False");
        }
      });

      it("Should withdraw: Withdrawing less than you can", async () => {
        await withdrawFromPool(
          lucid,
          lucid.newTx(),
          0n,
          emulator.now(),
          {
            amountToWithdraw: 500n * 100000n,
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators },
          -500n
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should withdraw pool Rewards successfully", async () => {
        await withdrawPoolRewards(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            loanOracleDetails: loanOracle,
            now: emulator.now(),
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should update pool config", async () => {
        await updateConfig(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should delete succesfully", async () => {
        // Delete Pool
        await deletePool(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: creationResult.poolId,
          },
          { validators, deployedValidators },
          creationResult.lpTokenPolicy
        ).then(quickSubmitBuilder(emulator));
      });
    });

    describe("Pool lifecycle (updated config)", () => {
      let creationResult: CreatePoolResult;
      let loanOracleValidator: Validator;
      let loanTokenOracleNft: string;
      beforeEach(async () => {
        if (loanTokenUnit !== "lovelace") {
          const oracleResult = await createMockOracle(
            lucid,
            lucid.newTx(),
            0n,
            {
              validators,
              deployedValidators,
            }
          );

          loanTokenOracleNft = oracleResult.oracleNft;
          loanOracleValidator = oracleResult.oracleValidator;

          await quickSubmitBuilder(emulator)({
            txBuilder: oracleResult.txBuilder,
          });
        }

        creationResult = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 2000000000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: "",
            loanOracleNft: loanTokenOracleNft,
          },
          {
            validators,
            deployedValidators,
          }
        );
        await quickSubmitBuilder(emulator)({
          txBuilder: creationResult.txBuilder,
        });
        emulator.distributeRewards(100000000n);

        await updateConfig(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should deposit succesfully", async () => {
        await depositIntoPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            balanceToDeposit: 500n * 10000000n,
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should withdraw succesfully", async () => {
        await withdrawFromPool(
          lucid,
          lucid.newTx(),
          0n,
          emulator.now(),
          {
            amountToWithdraw: 200n * 100000n,
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should withdraw pool Rewards successfully", async () => {
        await withdrawPoolRewards(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: creationResult.poolId,
            poolStakeValidator: creationResult.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            loanOracleDetails: loanOracle,
            now: emulator.now(),
          },
          { validators, deployedValidators }
        ).then(quickSubmitBuilder(emulator));
      });

      it("Should delete succesfully", async () => {
        // Delete Pool
        await deletePool(
          lucid,
          lucid.newTx(),
          {
            poolTokenName: creationResult.poolId,
          },
          { validators, deployedValidators },
          creationResult.lpTokenPolicy
        ).then(quickSubmitBuilder(emulator));
      });
    });

    describe("Borrowing", () => {
      let loanTokenOracleNft: string;
      let collateralTokenOracleNft: string;
      let loanOracleValidator: Validator;
      let collateralOracleValidator: Validator;
      let creationResultPool: CreatePoolResult; // Declare it here
      beforeEach(async () => {
        if (loanTokenUnit !== "lovelace") {
          const oracleResult = await createMockOracle(
            lucid,
            lucid.newTx(),
            0n,
            {
              validators,
              deployedValidators,
            }
          );

          loanTokenOracleNft = oracleResult.oracleNft;
          loanOracleValidator = oracleResult.oracleValidator;

          await quickSubmitBuilder(emulator)({
            txBuilder: oracleResult.txBuilder,
          });
        }

        if (collateralTokenUnit !== "lovelace") {
          const oracleResult = await createMockOracle(
            lucid,
            lucid.newTx(),
            0n,
            {
              validators,
              deployedValidators,
            }
          );

          collateralTokenOracleNft = oracleResult.oracleNft;
          collateralOracleValidator = oracleResult.oracleValidator;

          await quickSubmitBuilder(emulator)({
            txBuilder: oracleResult.txBuilder,
          });
        }

        creationResultPool = await createPool(
          lucid,
          lucid.newTx(),
          0n,
          {
            depositAmount: 20000000000000n,
            loanToken: loanTokenUnit == "lovelace" ? "" : loanTokenUnit,
            collateralToken:
              collateralTokenUnit == "lovelace" ? "" : collateralTokenUnit,
            collateralOracleNft: collateralTokenOracleNft,
            loanOracleNft: loanTokenOracleNft,
          },
          {
            validators,
            deployedValidators,
          }
        );

        await quickSubmitBuilder(emulator)({
          txBuilder: creationResultPool.txBuilder,
        });
      });

      it("Should borrow successfully", async () => {
        const borrowResults = await borrowFromPool(
          lucid,
          lucid.newTx(),
          0n,
          emulator.now(),
          {
            loanAmount: loanAmount,
            collateralAmount: collateralAmount,
            poolTokenName: creationResultPool.poolId,
            poolStakeValidator: creationResultPool.stakingValidator,
            collateralOracleValidator,
            loanOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          },
          { validators, deployedValidators }
        );

        await quickSubmitBuilder(emulator)({
          txBuilder: borrowResults.txBuilder,
        });
      });

      describe("Borrowing", () => {
        let loanDetails: LoanDetails[] = [];
        beforeEach(async () => {
          loanDetails = [];
          const borrowResults = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults.txBuilder,
          });

          const borrowOutput = 1;
          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });
        });

        it("Should repay successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should not repay with fake mint", async () => {
          try {
            await repayLoan(
              lucid,
              lucid.newTx(),
              emulator.now(),
              loanDetails,
              {
                validators,
                deployedValidators,
              },
              true
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("nft_check ? False");
          }
        });

        it("Should repay to merge script successfully", async () => {
          await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });

          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate to MERGE successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          await poolLiquidateMerge(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT liquidate overcollaterized", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracle;
            loan.collateralOracleDetails = collateralOracle;
          });
          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("collateral_check ? False");
          }
        });

        it("Should liquidate undercollaterized and compensate borrower", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForPartialLiquidatinon;
            loan.collateralOracleDetails =
              collateralOracleForPartialLiquidatinon;
          });

          const liquidationResult = await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
              ignoreBorrower: false,
            },
            { validators, deployedValidators }
          );
          await quickSubmitBuilder(emulator)({
            txBuilder: liquidationResult.txBuilder,
          });
          expect(liquidationResult.borrowerCompensationExists).toBe(true);
        });

        it("Should liquidate undercollaterized and claim remaining collateral", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForPartialLiquidatinon;
            loan.collateralOracleDetails =
              collateralOracleForPartialLiquidatinon;
          });

          const liquidationOutput = await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
              ignoreBorrower: false,
            },
            { validators, deployedValidators }
          );

          const liquidationTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: liquidationOutput.txBuilder,
          });

          await claimLiquidated(
            lucid,
            lucid.newTx(),
            emulator.now(),
            liquidationTxHash,
            0,
            deployedValidators
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT liquidate undercollaterized because borrower is not compensated", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
                ignoreBorrower: true,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("liquidation_output_check ? False"); // IT fails on expect datum to liquidation address. can't capture it uniquely
          }
        });

        it("Should NOT liquidate to MERGE overcollaterized", async () => {
          try {
            await poolLiquidateMerge(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("collateral_check ? False");
          }
        });

        it("Should merge to Pool successfully", async () => {
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 123n,
            },
          ];

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT merge to Pool - does not repay enough", async () => {
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 123n,
            },
          ];

          try {
            await mergeToPool(
              lucid,
              lucid.newTx(),
              emulator.now(),
              mergeUtxos,
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            console.log(e);
            expect(e).toContain("repay_amt_check ? False");
          }
        });

        it("Should not liquidate expired loan oracle", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = expiredLoanOracle;
          });

          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            if (loanTokenPolicy === "") {
              expect(e).toContain("collateral_check ? False");
            } else {
              expect(e).toContain("oracle is expired");
            }
          }
        });

        it("Should not liquidate expired collateral oracle", async () => {
          loanDetails.forEach((loan) => {
            loan.collateralOracleDetails = expiredCollateralOracle;
          });

          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            if (collateralTokenPolicy === "") {
              expect(e).toContain("collateral_check ? False");
            } else {
              expect(e).toContain("oracle is expired");
            }
          }
        });

        beforeEach(async () => {
          const borrowResults2 = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash2 = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults2.txBuilder,
          });

          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash2, outputIndex: 1 },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults2.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
            collateralOracleValidator,
            loanOracleValidator,
          });
        });

        it("Should repay 2 loans to pool successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should repay 2 loans w delayed merge successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate 2 loans to pool successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate 2 loans w delayed merge successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });

          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should merge 2 loans to pool successfully", async () => {
          // Repay 2 loans
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });

          // Not clean for the moment. These likely are not sorted that well.
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 0n,
            },
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[1],
              poolTokenName: loanDetails[1].poolTokenName,
              poolStakeValidator: loanDetails[1].poolStakeValidator,
              reduction: 0n,
            },
          ];

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should merge 2+1 loans to pool successfully", async () => {
          // Repay 2 loans
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });

          // Not clean for the moment. These likely are not sorted that well.
          let mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 0n,
            },
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[1],
              poolTokenName: loanDetails[1].poolTokenName,
              poolStakeValidator: loanDetails[1].poolStakeValidator,
              reduction: 0n,
            },
          ];

          loanDetails = [];
          const borrowResults = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults.txBuilder,
          });

          const borrowOutput = 1;
          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });

          const mergeUtxo2 = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash2 = await quickSubmitBuilder(emulator)({
            txBuilder: mergeUtxo2.txBuilder,
          });

          mergeUtxos.push({
            txHash: mergeTxHash2,
            outputIndex: mergeUtxo2.mergeOutputs[0],
            poolTokenName: loanDetails[0].poolTokenName,
            poolStakeValidator: loanDetails[0].poolStakeValidator,
            reduction: 0n,
          });

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });
      });

      describe("Borrowing (updated config)", () => {
        let loanDetails: LoanDetails[] = [];
        beforeEach(async () => {
          loanDetails = [];
          const borrowResults = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults.txBuilder,
          });

          const borrowOutput = 1;
          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });

          await updateConfig(
            lucid,
            lucid.newTx(),
            {
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should repay successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should repay to merge script successfully", async () => {
          await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });

          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate to MERGE successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          await poolLiquidateMerge(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT liquidate overcollaterized", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracle;
            loan.collateralOracleDetails = collateralOracle;
          });
          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("collateral_check ? False");
          }
        });

        it("Should liquidate undercollaterized and compensate borrower", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForPartialLiquidatinon;
            loan.collateralOracleDetails =
              collateralOracleForPartialLiquidatinon;
          });

          const liquidationResult = await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
              ignoreBorrower: false,
            },
            { validators, deployedValidators }
          );
          await quickSubmitBuilder(emulator)({
            txBuilder: liquidationResult.txBuilder,
          });
          expect(liquidationResult.borrowerCompensationExists).toBe(true);
        });

        it("Should liquidate undercollaterized and claim remaining collateral", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForPartialLiquidatinon;
            loan.collateralOracleDetails =
              collateralOracleForPartialLiquidatinon;
          });

          const liquidationOutput = await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
              ignoreBorrower: false,
            },
            { validators, deployedValidators }
          );

          const liquidationTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: liquidationOutput.txBuilder,
          });

          await claimLiquidated(
            lucid,
            lucid.newTx(),
            emulator.now(),
            liquidationTxHash,
            0,
            deployedValidators
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT liquidate undercollaterized because borrower is not compensated", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
                ignoreBorrower: true,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("liquidation_output_check ? False"); // IT fails on expect datum to liquidation address. can't capture it uniquely
          }
        });

        it("Should NOT liquidate to MERGE overcollaterized", async () => {
          try {
            await poolLiquidateMerge(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("collateral_check ? False");
          }
        });

        it("Should merge to Pool successfully", async () => {
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 123n,
            },
          ];

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT merge to Pool - does not repay enough", async () => {
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 123n,
            },
          ];

          try {
            await mergeToPool(
              lucid,
              lucid.newTx(),
              emulator.now(),
              mergeUtxos,
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            console.log(e);
            expect(e).toContain("repay_amt_check ? False");
          }
        });

        beforeEach(async () => {
          const borrowResults2 = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash2 = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults2.txBuilder,
          });

          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash2, outputIndex: 1 },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults2.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
            collateralOracleValidator,
            loanOracleValidator,
          });
        });

        it("Should repay 2 loans to pool successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should repay 2 loans w delayed merge successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate 2 loans to pool successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate 2 loans w delayed merge successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });

          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should merge 2 loans to pool successfully", async () => {
          // Repay 2 loans
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });

          // Not clean for the moment. These likely are not sorted that well.
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 0n,
            },
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[1],
              poolTokenName: loanDetails[1].poolTokenName,
              poolStakeValidator: loanDetails[1].poolStakeValidator,
              reduction: 0n,
            },
          ];

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should merge 2+1 loans to pool successfully", async () => {
          // Repay 2 loans
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });

          // Not clean for the moment. These likely are not sorted that well.
          let mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 0n,
            },
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[1],
              poolTokenName: loanDetails[1].poolTokenName,
              poolStakeValidator: loanDetails[1].poolStakeValidator,
              reduction: 0n,
            },
          ];

          loanDetails = [];
          const borrowResults = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults.txBuilder,
          });

          const borrowOutput = 1;
          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });

          const mergeUtxo2 = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash2 = await quickSubmitBuilder(emulator)({
            txBuilder: mergeUtxo2.txBuilder,
          });

          mergeUtxos.push({
            txHash: mergeTxHash2,
            outputIndex: mergeUtxo2.mergeOutputs[0],
            poolTokenName: loanDetails[0].poolTokenName,
            poolStakeValidator: loanDetails[0].poolStakeValidator,
            reduction: 0n,
          });

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });
      });

      describe("Borrowing (update oracle script)", () => {
        let loanDetails: LoanDetails[] = [];
        beforeEach(async () => {
          loanDetails = [];

          if (loanTokenPolicy !== "") {
            const updateOracleResults = await updateOracle(
              lucid,
              lucid.newTx(),
              loanTokenOracleNft,
              loanOracleValidator,
              {
                poolTokenName: creationResultPool.poolId,
                poolStakeValidator: creationResultPool.stakingValidator,
              },
              { validators, deployedValidators }
            );

            await quickSubmitBuilder(emulator)({
              txBuilder: updateOracleResults.txBuilder,
            });
            loanOracleValidator = updateOracleResults.validator;
          }

          if (collateralTokenPolicy !== "") {
            const updateOracleResults = await updateOracle(
              lucid,
              lucid.newTx(),
              collateralTokenOracleNft,
              collateralOracleValidator,
              {
                poolTokenName: creationResultPool.poolId,
                poolStakeValidator: creationResultPool.stakingValidator,
              },
              { validators, deployedValidators }
            );

            await quickSubmitBuilder(emulator)({
              txBuilder: updateOracleResults.txBuilder,
            });
            collateralOracleValidator = updateOracleResults.validator;
          }

          const borrowResults = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults.txBuilder,
          });

          const borrowOutput = 1;

          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });
        });

        it("Should repay successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should repay to merge script successfully", async () => {
          await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });

          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate to MERGE successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          await poolLiquidateMerge(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT liquidate overcollaterized", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracle;
            loan.collateralOracleDetails = collateralOracle;
          });
          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("collateral_check ? False");
          }
        });

        it("Should liquidate undercollaterized and compensate borrower", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForPartialLiquidatinon;
            loan.collateralOracleDetails =
              collateralOracleForPartialLiquidatinon;
          });
          const liquidationResult = await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
              ignoreBorrower: false,
            },
            { validators, deployedValidators }
          );
          await quickSubmitBuilder(emulator)({
            txBuilder: liquidationResult.txBuilder,
          });
          expect(liquidationResult.borrowerCompensationExists).toBe(true);
        });

        it("Should liquidate undercollaterized and claim remaining collateral", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForPartialLiquidatinon;
            loan.collateralOracleDetails =
              collateralOracleForPartialLiquidatinon;
          });

          const liquidationOutput = await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
              ignoreBorrower: false,
            },
            { validators, deployedValidators }
          );

          const liquidationTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: liquidationOutput.txBuilder,
          });

          await claimLiquidated(
            lucid,
            lucid.newTx(),
            emulator.now(),
            liquidationTxHash,
            0,
            deployedValidators
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT liquidate undercollaterized because borrower is not compensated", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          try {
            await poolLiquidate(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
                ignoreBorrower: true,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("liquidation_output_check ? False"); // IT fails on expect datum to liquidation address. can't capture it uniquely
          }
        });

        it("Should NOT liquidate to MERGE overcollaterized", async () => {
          try {
            await poolLiquidateMerge(
              lucid,
              lucid.newTx(),
              emulator.now(),
              {
                loanDetails,
              },
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            expect(e).toContain("collateral_check ? False");
          }
        });

        it("Should merge to Pool successfully", async () => {
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 123n,
            },
          ];

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should NOT merge to Pool - does not repay enough", async () => {
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 123n,
            },
          ];

          try {
            await mergeToPool(
              lucid,
              lucid.newTx(),
              emulator.now(),
              mergeUtxos,
              { validators, deployedValidators }
            ).then(quickSubmitBuilder(emulator));
          } catch (e) {
            console.log(e);
            expect(e).toContain("repay_amt_check ? False");
          }
        });

        beforeEach(async () => {
          const borrowResults2 = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash2 = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults2.txBuilder,
          });

          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash2, outputIndex: 1 },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults2.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
            collateralOracleValidator,
            loanOracleValidator,
          });
        });

        it("Should repay 2 loans to pool successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should repay 2 loans w delayed merge successfully", async () => {
          await repayLoan(lucid, lucid.newTx(), emulator.now(), loanDetails, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate 2 loans to pool successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });
          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should liquidate 2 loans w delayed merge successfully", async () => {
          loanDetails.forEach((loan) => {
            loan.loanOracleDetails = loanOracleForLiquidatinon;
            loan.collateralOracleDetails = collateralOracleForLiquidatinon;
          });

          await poolLiquidate(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          ).then(quickSubmitBuilder(emulator));
        });

        it("Should merge 2 loans to pool successfully", async () => {
          // Repay 2 loans
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });

          // Not clean for the moment. These likely are not sorted that well.
          const mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 0n,
            },
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[1],
              poolTokenName: loanDetails[1].poolTokenName,
              poolStakeValidator: loanDetails[1].poolStakeValidator,
              reduction: 0n,
            },
          ];

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });

        it("Should merge 2+1 loans to pool successfully", async () => {
          // Repay 2 loans
          const mergeResult = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: mergeResult.txBuilder,
          });

          // Not clean for the moment. These likely are not sorted that well.
          let mergeUtxos = [
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[0],
              poolTokenName: loanDetails[0].poolTokenName,
              poolStakeValidator: loanDetails[0].poolStakeValidator,
              reduction: 0n,
            },
            {
              txHash: mergeTxHash,
              outputIndex: mergeResult.mergeOutputs[1],
              poolTokenName: loanDetails[1].poolTokenName,
              poolStakeValidator: loanDetails[1].poolStakeValidator,
              reduction: 0n,
            },
          ];

          loanDetails = [];
          const borrowResults = await borrowFromPool(
            lucid,
            lucid.newTx(),
            0n,
            emulator.now(),
            {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              poolTokenName: creationResultPool.poolId,
              poolStakeValidator: creationResultPool.stakingValidator,
              collateralOracleValidator,
              loanOracleValidator,
              loanOracleDetails: loanOracle,
              collateralOracleDetails: collateralOracle,
            },
            { validators, deployedValidators }
          );

          const borrowTxHash = await quickSubmitBuilder(emulator)({
            txBuilder: borrowResults.txBuilder,
          });

          const borrowOutput = 1;
          loanDetails.push({
            loanUtxo: { txHash: borrowTxHash, outputIndex: borrowOutput },
            poolTokenName: creationResultPool.poolId,
            borrowerTokenName: borrowResults.borrowerTokenName,
            poolStakeValidator: creationResultPool.stakingValidator,
            loanOracleValidator: loanOracleValidator,
            collateralOracleValidator: collateralOracleValidator,
            loanOracleDetails: loanOracle,
            collateralOracleDetails: collateralOracle,
          });

          const mergeUtxo2 = await repayLoanToMege(
            lucid,
            lucid.newTx(),
            emulator.now(),
            {
              loanDetails,
            },
            { validators, deployedValidators }
          );

          const mergeTxHash2 = await quickSubmitBuilder(emulator)({
            txBuilder: mergeUtxo2.txBuilder,
          });

          mergeUtxos.push({
            txHash: mergeTxHash2,
            outputIndex: mergeUtxo2.mergeOutputs[0],
            poolTokenName: loanDetails[0].poolTokenName,
            poolStakeValidator: loanDetails[0].poolStakeValidator,
            reduction: 0n,
          });

          await mergeToPool(lucid, lucid.newTx(), emulator.now(), mergeUtxos, {
            validators,
            deployedValidators,
          }).then(quickSubmitBuilder(emulator));
        });
      });
    });
  });
}

// testTokenScenario(
//   "Loan: ADA; collateral: LENFI",
//   {
//     policy: "",
//     name: "",
//   },
//   {
//     policy: LENFI_POLICY_ID,
//     name: LENFI_TOKEN_NAME,
//   },
//   45000000n, // Loan amount
//   45000000n, // collateral amount
//   undefined,
//   undefined,
//   undefined,
//   await signedOracleFeed("lenfiAggregatedExpensive"),
//   await signedOracleFeed("lenfiAggregatedCheap"),
//   await signedOracleFeed("lenfiPooledFairlyCheap"),
//   undefined,
//   await signedOracleFeed("lenfiExpiredOracle")
// );

// testTokenScenario(
//   "Loan: LENFI; collateral: ADA",
//   {
//     policy: LENFI_POLICY_ID,
//     name: LENFI_TOKEN_NAME,
//   },
//   {
//     policy: "",
//     name: "",
//   },
//   45000000n,
//   45000000n,
//   await signedOracleFeed("lenfiAggregatedCheap"),
//   await signedOracleFeed("lenfiAggregatedExpensive"),
//   await signedOracleFeed("lenfiAggregatedFairlyExpensive"),
//   undefined,
//   undefined,
//   undefined,
//   await signedOracleFeed("lenfiExpiredOracle"),
//   undefined
// );

// // Testing when none of assets are ADA
// testTokenScenario(
//   "Loan: MIN; collateral: LENFI",
//   {
//     policy: MIN_POLICY_ID,
//     name: MIN_TOKEN_NAME,
//   },
//   {
//     policy: LENFI_POLICY_ID,
//     name: LENFI_TOKEN_NAME,
//   },
//   30000000n,
//   30000000n,
//   await signedOracleFeed("minAggregatedCheap"),
//   await signedOracleFeed("minAggregatedExpensive"),
//   await signedOracleFeed("minAggregatedFairlyExpensive"),
//   await signedOracleFeed("lenfiAggregatedExpensive"),
//   await signedOracleFeed("lenfiAggregatedCheap"),
//   await signedOracleFeed("lenfiAggregatedFairlyCheap"),
//   await signedOracleFeed("minExpiredOracle"),
//   await signedOracleFeed("lenfiExpiredOracle")
// );

// Testing when one of oracle is pooled
// testTokenScenario(
//   "Loan: LENFI (Pooled); collateral: ADA",
//   {
//     policy: LENFI_POLICY_ID,
//     name: LENFI_TOKEN_NAME,
//   },
//   {
//     policy: "",
//     name: "",
//   },
//   50000000n, // Loan amount
//   50000000n, // collateral amount
//   await signedOracleFeed("lenfiPooledCheap"),
//   await signedOracleFeed("lenfiPooledExpensive"),
//   await signedOracleFeed("lenfiAggregatedFairlyExpensive"),
//   undefined,
//   undefined,
//   undefined,
//   await signedOracleFeed("lenfiExpiredOracle"),
//   undefined
// );

// testTokenScenario(
//   "Loan: ADA; collateral: LENFI (Pooled); ",
//   {
//     policy: "",
//     name: "",
//   },
//   {
//     policy: LENFI_POLICY_ID,
//     name: LENFI_TOKEN_NAME,
//   },
//   50000000n, // Loan amount
//   50000000n, // collateral amount
//   undefined,
//   undefined,
//   undefined,
//   await signedOracleFeed("lenfiPooledExpensive"),
//   await signedOracleFeed("lenfiPooledCheap"),
//   await signedOracleFeed("lenfiPooledFairlyCheap"),
//   undefined,
//   await signedOracleFeed("lenfiExpiredOracle")
// );

testTokenScenario(
  "Loan: LENFI (Pooled); collateral: MIN (Pooled) ",
  {
    policy: LENFI_POLICY_ID,
    name: LENFI_TOKEN_NAME,
  },
  {
    policy: "",
    name: "",
  },
  50000000n, // Loan amount
  50000000n, // collateral amount
  await signedOracleFeed("lenfiPooledCheap"),
  await signedOracleFeed("lenfiPooledExpensive"),
  await signedOracleFeed("lenfiAggregatedFairlyExpensive"),
  await signedOracleFeed("minPooledExpensive"),
  await signedOracleFeed("minPooledCheap"),
  await signedOracleFeed("minPooledFairlyCheap"),
  await signedOracleFeed("lenfiExpiredOracle"),
  await signedOracleFeed("minExpiredOracle")
);
