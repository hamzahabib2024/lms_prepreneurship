import { Module } from "@nestjs/common";
import { PartnerService } from "./partner.service";
import { PartnerController } from "./partner.controller";

/**
 * §5 — institutes that send us students, and the portal they see.
 *
 * Owns nothing but itself: the students, grades and certificates it reads all
 * belong to other modules and are reached through the scoped client, which is
 * what confines a partner to their own cohort.
 */
@Module({
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
