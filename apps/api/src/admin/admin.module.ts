import { Module } from "@nestjs/common";
import { UserAdminService } from "./user-admin.service";
import { UserAdminController } from "./user-admin.controller";
import { AuditViewerService } from "./audit-viewer.service";
import { AuditViewerController } from "./audit-viewer.controller";
import { SecurityLogService } from "./security-log.service";
import { SecurityLogController } from "./security-log.controller";
import { ImpersonationService } from "./impersonation.service";
import { ImpersonationController } from "./impersonation.controller";
import { PersonalDataService } from "./personal-data.service";
import { PersonalDataController } from "./personal-data.controller";
import { MaintenanceController } from "./maintenance.controller";
import { BulkService } from "./bulk.service";
import { BulkController } from "./bulk.controller";
import { BackupService } from "./backup.service";
import { BackupController } from "./backup.controller";
import { CohortImportService } from "./cohort-import.service";
import { CohortImportController } from "./cohort-import.controller";
import { AcademicModule } from "../academic/academic.module";
import { AdmissionModule } from "../admission/admission.module";

/**
 * §4.5.1 — the accounts of the people who run the Institute.
 *
 * AuthService comes from the global auth module: password hashing lives there
 * and a second implementation would be a second thing to get wrong.
 */
@Module({
  // AcademicModule for EnrolmentService: a bulk transfer calls the ORDINARY
  // transfer once per student, so the gender restriction, capacity and roll
  // number rules cannot be bypassed by doing many at once.
  // AdmissionModule for RegistrationNumberService: an import allocates
  // registration and roll numbers through the SAME service the ordinary
  // approval uses, so a returning student keeps their number and two
  // operators cannot claim one roll number.
  imports: [AcademicModule, AdmissionModule],
  controllers: [UserAdminController, AuditViewerController, SecurityLogController, ImpersonationController, PersonalDataController, MaintenanceController, BulkController, BackupController, CohortImportController],
  providers: [UserAdminService, AuditViewerService, SecurityLogService, ImpersonationService, PersonalDataService, BulkService, BackupService, CohortImportService],
  exports: [UserAdminService],
})
export class AdminModule {}
