import { Controller, Delete, Get, Query } from "@nestjs/common";
import { IntegrationService } from "./integration.service";
import { RequirePermission } from "../rbac/permissions.guard";

/** SRS §3.4 — which external providers are connected, and what happens if not. */
@Controller("integrations")
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  /**
   * `provider_binding:read` — which provider is bound, not what it is bound
   * with. A teacher holds this and should: they need to know whether a Meet
   * link will be created for them or whether they must paste one in.
   */
  @RequirePermission("provider_binding", "read")
  @Get()
  statuses() {
    return this.integrations.statuses();
  }

  /**
   * A DIFFERENT GUARD, deliberately.
   *
   * The list above says which providers are connected. This returns the text of
   * messages addressed to named people, which can carry a mark, an attendance
   * warning or a balance (SEC-PRV-003). Reusing provider_binding here would
   * hand every teacher the notification bodies of students they do not teach —
   * the recurring defect in this codebase is exactly this, one resource named
   * after a topic guarding endpoints that serve different audiences.
   */
  @RequirePermission("notification_config", "configure")
  @Get("outbox")
  outbox(@Query("limit") limit?: string) {
    return this.integrations.outboxMessages(limit ? Number(limit) : undefined);
  }

  @RequirePermission("notification_config", "configure")
  @Delete("outbox")
  clearOutbox() {
    return this.integrations.clearOutbox();
  }
}
