/**
 * Load the project's .env before any test runs.
 *
 * admission.int-spec.ts needs a real database and guards itself with
 * `DATABASE_URL ? describe : describe.skip`. That guard is right, but nothing
 * was putting DATABASE_URL into the test environment: it ran only when the
 * variable happened to be exported in the shell already, and when it was not,
 * jest printed a warning that scrolled past and then reported the suite as
 * PASSED. A green run that tested nothing is worse than a red one.
 *
 * The .env lives at the repository root, while jest runs with cwd at apps/api,
 * so `-r dotenv/config` would look in the wrong place. The path is explicit.
 */
const { join } = require("node:path");

require("dotenv").config({ path: join(__dirname, "../../.env") });
