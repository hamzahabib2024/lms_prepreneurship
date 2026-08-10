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
import { AcademicModule } from "../academic/academic.module";

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
  imports: [AcademicModule],
  controllers: [UserAdminController, AuditViewerController, SecurityLogController, ImpersonationController, PersonalDataController, MaintenanceController, BulkController, BackupController],
  providers: [UserAdminService, AuditViewerService, SecurityLogService, ImpersonationService, PersonalDataService, BulkService, BackupService],
  exports: [UserAdminService],
})
export class AdminModule {}
