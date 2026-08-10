import { Module } from "@nestjs/common";
import { FeeService } from "./fee.service";
import { FeeController } from "./fee.controller";

/** §5.16 — fees: what a student owes, and what they have paid. */
@Module({
  controllers: [FeeController],
  providers: [FeeService],
  exports: [FeeService],
})
export class FinanceModule {}
