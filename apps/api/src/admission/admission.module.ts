import { Module } from "@nestjs/common";
import { AdmissionService } from "./admission.service";
import { AdmissionController } from "./admission.controller";
import { RegistrationNumberService } from "./registration-number.service";
import { SlipService } from "./slip.service";
import { ContentModule } from "../content/content.module";

@Module({
  // ContentModule for the storage registry: a slip goes wherever the
  // Institute has configured documents to live (ARC-043).
  imports: [ContentModule],
  controllers: [AdmissionController],
  providers: [AdmissionService, RegistrationNumberService, SlipService],
  exports: [RegistrationNumberService],
})
export class AdmissionModule {}
