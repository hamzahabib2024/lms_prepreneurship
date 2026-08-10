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

/**
 * §4.5.1 — the accounts of the people who run the Institute.
 *
 * AuthService comes from the global auth module: password hashing lives there
 * and a second implementation would be a second thing to get wrong.
 */
@Module({
  controllers: [UserAdminController, AuditViewerController, SecurityLogController, ImpersonationController, PersonalDataController],
  providers: [UserAdminService, AuditViewerService, SecurityLogService, ImpersonationService, PersonalDataService],
  exports: [UserAdminService],
})
export class AdminModule {}
