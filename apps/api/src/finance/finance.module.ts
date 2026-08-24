import { Module } from "@nestjs/common";
import { FeeService } from "./fee.service";
import { FeeController } from "./fee.controller";
import { InstalmentService } from "./instalment.service";
import { ReceiptService } from "./receipt.service";
import { FeeStructureService } from "./fee-structure.service";
import { FeeStructureController } from "./fee-structure.controller";
import { PaymentSubmissionService } from "./payment-submission.service";
import { PaymentSubmissionController } from "./payment-submission.controller";
import { FeeMailer } from "./fee-mailer";
import { AdmissionModule } from "../admission/admission.module";
import { NotificationModule } from "../notification/notification.module";
import { ContentModule } from "../content/content.module";

/** §5.16 — fees: what a student owes, and what they have paid. */
@Module({
  // AdmissionModule for RegistrationNumberService: a receipt number comes
  // from the same atomic sequence allocator as a registration number, so two
  // clerks printing at once cannot be handed one number twice. It also brings
  // SlipService, so a payment proof is stored by the same code that stores an
  // applicant's slip rather than by a second copy of the content sniffing.
  //
  // NotificationModule because verifying a payment tells the student — by
  // email with the receipt attached, and in their inbox. ContentModule for the
  // storage registry: the proof is streamed back through it, never linked.
  imports: [AdmissionModule, NotificationModule, ContentModule],
  controllers: [FeeController, FeeStructureController, PaymentSubmissionController],
  providers: [
    FeeService,
    InstalmentService,
    ReceiptService,
    FeeStructureService,
    PaymentSubmissionService,
    FeeMailer,
  ],
  // FeeStructureService is exported for the admission module: the public
  // prospectus quotes a programme's published fee, and the apply page needs
  // the same figures the office set rather than a second copy of them.
  exports: [FeeService, FeeStructureService],
})
export class FinanceModule {}
