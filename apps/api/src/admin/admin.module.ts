import { Module } from "@nestjs/common";
import { UserAdminService } from "./user-admin.service";
import { UserAdminController } from "./user-admin.controller";
import { AuditViewerService } from "./audit-viewer.service";
import { AuditViewerController } from "./audit-viewer.controller";

/**
 * §4.5.1 — the accounts of the people who run the Institute.
 *
 * AuthService comes from the global auth module: password hashing lives there
 * and a second implementation would be a second thing to get wrong.
 */
@Module({
  controllers: [UserAdminController, AuditViewerController],
  providers: [UserAdminService, AuditViewerService],
  exports: [UserAdminService],
})
export class AdminModule {}
