import { Module } from "@nestjs/common";
import { PartnerService } from "./partner.service";
import { PartnerController } from "./partner.controller";
import { AdmissionModule } from "../admission/admission.module";

/**
 * §5 — institutes that send us students, and the portal they see.
 *
 * Owns nothing but itself: the students, grades and certificates it reads all
 * belong to other modules and are reached through the scoped client, which is
 * what confines a partner to their own cohort.
 */
@Module({
  // AdmissionModule for RegistrationNumberService: an invoice number comes
  // from the same atomic series a receipt number does, so two clerks raising
  // invoices at once cannot be handed one number twice.
  imports: [AdmissionModule],
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
