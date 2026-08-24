import { Module } from "@nestjs/common";
import { AdmissionService } from "./admission.service";
import { AdmissionMailer } from "./admission-mailer";
import { AdmissionController } from "./admission.controller";
import { RegistrationNumberService } from "./registration-number.service";
import { SlipService } from "./slip.service";
import { ContentModule } from "../content/content.module";

@Module({
  // ContentModule for the storage registry: a slip goes wherever the
  // Institute has configured documents to live (ARC-043).
  imports: [ContentModule],
  controllers: [AdmissionController],
  providers: [AdmissionService, AdmissionMailer, RegistrationNumberService, SlipService],
  // SlipService is exported for the finance module: a student photographing
  // the receipt for their second instalment is doing the same thing an
  // applicant does with their admission slip, and it must be sniffed, hashed
  // and stored by the same code (SEC-FIL-003).
  exports: [RegistrationNumberService, SlipService],
})
export class AdmissionModule {}
