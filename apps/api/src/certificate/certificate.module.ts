import { Module } from "@nestjs/common";
import { CertificateService } from "./certificate.service";
import { SignatoryService } from "./signatory.service";
import { CertificateController } from "./certificate.controller";
import { ProgressModule } from "../progress/progress.module";
import { RegistrationNumberService } from "../admission/registration-number.service";

/**
 * ProgressModule is imported because issue RECOMPUTES the student's standing
 * rather than trusting anything the caller sent — that check is what makes the
 * certificate mean something.
 */
@Module({
  imports: [ProgressModule],
  controllers: [CertificateController],
  providers: [CertificateService, RegistrationNumberService, SignatoryService],
  exports: [CertificateService],
})
export class CertificateModule {}
