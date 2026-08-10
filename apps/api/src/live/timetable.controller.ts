import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { TimetableService } from "./timetable.service";
import { RequirePermission } from "../rbac/permissions.guard";

const patternSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  hostTeacherId: z.string().uuid(),
  days: z.array(z.number().int().min(0).max(6)),
  startTime: z.string(),
  endTime: z.string(),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  exclusions: z.array(z.coerce.date()).optional(),
  titleTemplate: z.string().trim().max(200).optional(),
  sessionType: z.enum(["ONLINE", "OFFLINE"]).optional(),
  attendancePolicy: z.enum(["MANUAL", "SELF_CHECKIN", "PROVIDER_DERIVED", "HYBRID"]).optional(),
});

/**
 * SRS §9.5 — the timetable.
 *
 * `timetable:read` reaches a student at ENROLLED scope and a teacher at
 * ASSIGNED: whose classes you see is decided by the LiveSession policy, so
 * /timetable/me takes no id and cannot be pointed at somebody else.
 *
 * Generating is `timetable:update`, which a teacher also holds for their own
 * sections — the ordinary scheduler refuses anything outside them.
 *
 * The bounds are NOT in the schema. zod would answer "Array must contain at
 * least 1 element(s)" and shadow timetable.ts, which says "Choose at least one
 * day of the week" — the same reason the rubric and bulk schemas stay quiet.
 */
/**
 * "2027-03-31" means the WHOLE of the 31st.
 *
 * A bare date parses as midnight, so an inclusive-looking range quietly
 * excludes the final day's classes — a student asking for "this week" would
 * lose Sunday's, and nothing about the response would say so. A range with a
 * time in it is taken at its word.
 */
function endOfDayIfDateOnly(value: string): Date {
  const parsed = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return new Date(parsed.getTime() + 86_400_000 - 1);
  }
  return parsed;
}

@Controller()
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  /** FR-LIV-034 — my classes, grouped into days. */
  @RequirePermission("timetable", "read")
  @Get("timetable/me")
  mine(@Query("from") from?: string, @Query("to") to?: string) {
    return this.timetable.mine(
      from ? new Date(from) : undefined,
      to ? endOfDayIfDateOnly(to) : undefined,
    );
  }

  /** FR-LIV-031 — what a pattern would create. */
  @RequirePermission("timetable", "update")
  @Post("timetable/preview")
  @HttpCode(200)
  preview(@Body() body: unknown) {
    return this.timetable.preview(patternSchema.parse(body) as never);
  }

  /** FR-LIV-032 — create them, one ordinary scheduling at a time. */
  @RequirePermission("timetable", "update")
  @Post("timetable/generate")
  @HttpCode(200)
  generate(@Body() body: unknown) {
    return this.timetable.generate(patternSchema.parse(body) as never);
  }
}
