import { Test } from "@nestjs/testing";
import { AppModule } from "./app.module";

/**
 * DOES THE APPLICATION START?
 *
 * Written after a change that passed the typechecker and all 1143 other tests
 * and left the API in a restart loop: a service gained a constructor argument
 * and the provider was never registered in its module. Nest resolves that
 * graph at RUN TIME, so TypeScript cannot see it, and no unit test builds it —
 * every one of them constructs its subject by hand with fakes, which is
 * exactly what makes them fast and exactly why they cannot see this.
 *
 *   Nest can't resolve dependencies of the AdmissionService (…, ?).
 *   Please make sure that the argument AdmissionMailer at index [8] is
 *   available in the AdmissionModule context.
 *
 * The whole failure is one missing name in a providers array, and it takes the
 * entire API down — every endpoint, not the one that changed.
 *
 * compile() resolves the graph without calling onModuleInit, so NOTHING
 * CONNECTS: no database, no mail server, no keys. That is what lets this run
 * on a machine with nothing set up, and it is also its limit — this proves the
 * wiring is complete, not that the application works.
 */
describe("the application module", () => {
  it("resolves every provider in the graph", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // Non-vacuous: prove the graph was actually built and something specific
    // came out of it, rather than passing because compile() returned anything.
    const { AdmissionService } = await import("./admission/admission.service");
    expect(moduleRef.get(AdmissionService, { strict: false })).toBeDefined();

    await moduleRef.close();
  }, 60_000);
});
