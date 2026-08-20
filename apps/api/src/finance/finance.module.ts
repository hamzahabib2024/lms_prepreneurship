import { Module } from "@nestjs/common";
import { FeeService } from "./fee.service";
import { FeeController } from "./fee.controller";
import { InstalmentService } from "./instalment.service";
import { ReceiptService } from "./receipt.service";
import { FeeStructureService } from "./fee-structure.service";
import { FeeStructureController } from "./fee-structure.controller";
import { AdmissionModule } from "../admission/admission.module";

/** §5.16 — fees: what a student owes, and what they have paid. */
@Module({
  // AdmissionModule for RegistrationNumberService: a receipt number comes
  // from the same atomic sequence allocator as a registration number, so two
  // clerks printing at once cannot be handed one number twice.
  imports: [AdmissionModule],
  controllers: [FeeController, FeeStructureController],
  providers: [FeeService, InstalmentService, ReceiptService, FeeStructureService],
  // FeeStructureService is exported for the admission module: the public
  // prospectus quotes a programme's published fee, and the apply page needs
  // the same figures the office set rather than a second copy of them.
  exports: [FeeService, FeeStructureService],
})
export class FinanceModule {}
