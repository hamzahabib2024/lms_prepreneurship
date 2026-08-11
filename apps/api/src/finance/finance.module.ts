import { Module } from "@nestjs/common";
import { FeeService } from "./fee.service";
import { FeeController } from "./fee.controller";
import { InstalmentService } from "./instalment.service";
import { ReceiptService } from "./receipt.service";
import { AdmissionModule } from "../admission/admission.module";

/** §5.16 — fees: what a student owes, and what they have paid. */
@Module({
  // AdmissionModule for RegistrationNumberService: a receipt number comes
  // from the same atomic sequence allocator as a registration number, so two
  // clerks printing at once cannot be handed one number twice.
  imports: [AdmissionModule],
  controllers: [FeeController],
  providers: [FeeService, InstalmentService, ReceiptService],
  exports: [FeeService],
})
export class FinanceModule {}
