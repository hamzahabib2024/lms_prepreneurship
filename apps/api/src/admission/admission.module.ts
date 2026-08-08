import { Module } from "@nestjs/common";
import { AdmissionService } from "./admission.service";
import { AdmissionController } from "./admission.controller";
import { RegistrationNumberService } from "./registration-number.service";

@Module({
  controllers: [AdmissionController],
  providers: [AdmissionService, RegistrationNumberService],
  exports: [RegistrationNumberService],
})
export class AdmissionModule {}
