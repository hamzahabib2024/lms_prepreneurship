import { Body, Controller, Get, Put } from "@nestjs/common";
import { z } from "zod";
import { PublicPageService } from "./public-page.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

/**
 * A value is `unknown` here on purpose, exactly as it is on the settings route.
 * The catalogue knows what each key may hold and says so in words a person can
 * act on; a Zod union here would either duplicate that or disagree with it, and
 * the disagreeing version is the one that ships.
 *
 * `null` is the one shape given meaning at this level: it means remove the
 * override and go back to the wording the System was installed with.
 */
const saveSchema = z.object({
  values: z.record(z.unknown()).refine((v) => Object.keys(v).length <= 60, {
    // A ceiling on the SHAPE of the request, not on the content. The Public
    // page group holds around twenty keys; sixty is room to grow and still
    // refuses a body built to make the server validate ten thousand fields.
    message: "That is more changes than this page has fields.",
  }),
});

/**
 * The public page editor — FR-PUB, SRS §13.2.
 *
 * BOTH DOORS ARE `public_page`, WHICH AN ADMIN HOLDS. That is the whole
 * reason this controller exists rather than a few more routes on the settings
 * controller: writing a setting is `system_setting:configure`, reserved to a
 * Super Admin because settings decide when a student is warned and what a
 * certificate requires. Nothing reachable through here decides anything about
 * anybody — it is a headline, a video link and the wording on a button, all of
 * it already published to the world — so the person who runs admissions can
 * correct the front page without holding the key to the restore command.
 *
 * The narrowing that makes that safe is in public-page.keys.ts and is derived
 * from the catalogue rather than typed, so the two cannot drift apart.
 */
@Controller()
export class PublicPageController {
  constructor(private readonly page: PublicPageService) {}

  /** Everything on the page that can be edited, with its default beside it. */
  @RequirePermission("public_page", "read")
  @Get("public-page")
  document() {
    return this.page.document();
  }

  /**
   * Save the changed fields. PUT, because this is one document with one state
   * rather than a collection somebody adds to.
   */
  @RequirePermission("public_page", "configure")
  @Put("public-page")
  save(@Body(zodBody(saveSchema)) dto: z.infer<typeof saveSchema>) {
    return this.page.save(dto.values);
  }
}
