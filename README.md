# Online Learning Management System

Implementation of **SRS-LMS-001 v2.1** (`LMS_Software_Requirements_Specification.docx`).

Code comments cite the requirement they satisfy — `FR-REG-039`, `ARC-051`,
`SEC-AUZ-002` and so on. When changing behaviour, check the cited requirement
first: if the code and the SRS disagree, one of them is a defect.

---

## Status

**Phase 0 complete; Phase 1 started.** The foundations that cannot be
retrofitted safely (§18.2) are done, and the first business module — admission
— is built on top of them.

Admission was chosen first because §2.2.2 identifies it as the Institute's most
error-prone process: lost payment slips, transcribed-wrong contact numbers,
registration numbers that collide or skip, and no record of who approved what.

| Built | Not yet |
|---|---|
| Monorepo, TypeScript strict, build pipeline | Academic structure CRUD |
| Prisma schema — core entities from §8 | Content, lectures, streaming |
| Auth: Argon2id, RS256 JWT, refresh rotation with reuse detection | Live sessions, LCAL adapters |
| Per-role lockout, session limits, step-up (§4.6) | Attendance, assessment |
| **The scope predicate (ARC-051)** | Reports, dashboards |
| RBAC guard wired to the §4.5 matrix | Notifications, email |
| Immutable audit log + database-level trigger | Web client |
| Response envelope, error model, correlation ids | |
| **Admission: UC-01 submit, UC-02 approve** | |
| Registration + roll numbering (Appendix B) | |
| Seed data, SQL constraints and indexes | |

---

## Prerequisites

- **Node.js 20 LTS or later** (24 works)
- **PostgreSQL 16** — mandated by §3.11, not interchangeable. §8.4 needs partial
  and BRIN indexes and DB-017 needs native partitioning; MySQL has none of them.
  `npm run db:start` provides one; nothing needs installing.
- **Redis** — not required. Playback tickets were the only thing that wanted it
  and they now live in the database, so the System runs on more than one
  instance without it.

## Running it

**Two commands from a clean checkout.** No Docker, no managed database, nothing
to sign up for — a real PostgreSQL 16 is downloaded on first run and its data
kept in `./pgdata`.

```bash
npm ci && npm run setup   # .env, signing keys, database, schema, sample data
npm start                 # both servers, in one terminal
```

Then open <http://localhost:5173>.

> **`npm ci`, not `npm install`.** On a fresh clone `npm install` twice left a
> partially installed `node_modules` — packages present as empty directories,
> which surfaces later as `Cannot find package '.../node_modules/pg/index.js'`
> while starting the database and reads as a database fault rather than an
> install one. `npm ci` installs exactly what the lockfile says and completed
> cleanly. `HANDOVER.md` covers this and the rest of moving to another machine.

> **The first `npm run setup` is slow.** It downloads a PostgreSQL 16 build
> before it can initialise anything — a few minutes, during which it looks
> stuck. Every run after that is seconds, and it is safe to run again.

`npm run setup` is safe to run again — every step checks whether it is already
done and says so rather than failing. It is deliberately separate from
`npm start`, so a deployment can set up once and let a process manager own the
running.

| | |
|---|---|
| <http://localhost:5173> | sign in |
| <http://localhost:5173/home> | the public page, as a visitor sees it |
| <http://localhost:3000/api/v1> | the API |
| <http://localhost:3000/docs> | the API reference |

The web app proxies `/api` to the API, so the browser sees one origin and CORS
behaves in development exactly as it will in production.

<details>
<summary>Running the pieces separately</summary>

```bash
npm run db:start    # PostgreSQL only
npm run dev         # the API  → http://localhost:3000/api/v1
npm run dev:web     # the app  → http://localhost:5173
```

`npm run setup` is the equivalent of `keys:generate`, `db:start` and
`db:setup` run in order, with each step skipped if it has already been done.

</details>

### Signing in

The seed creates one of each role. Every password follows the same pattern and
they are development credentials — the System forces a change on any account an
administrator provisions.

| Role | Email | Password |
| --- | --- | --- |
| Super Admin | `superadmin@institute.local` | `ChangeMe!SuperAdmin2026` |
| Admin | `admin@institute.local` | `ChangeMe!Admin2026` |
| Teacher | `sana@institute.local` | `ChangeMe!Teacher2026` |
| Student | `ayesha1@student.local` | `ChangeMe!Student2026` |

**Sign in as each of them in turn** — the navigation, the screens and the data
all change, because what a person may see is decided on the server rather than
hidden in the interface. A teacher has no Fees entry at all; a student's
Timetable is their own classes; the Security log is Super Admin alone.

Worth looking at, in roughly this order:

1. **Student** — Timetable, My subjects, a lesson with a handout, Fees.
2. **Teacher** — Attendance (keyboard-driven register), Marking, Rubrics,
   Content, and the same Timetable showing what they teach.
3. **Admin** — Admissions, People, Reports, Bulk changes.
4. **Super Admin** — Settings, Audit, Security, Backups. Try changing an
   attendance threshold in Settings and then running the Attendance Summary
   report: the report moves with it.

### Other commands

```bash
npm test                      # 803 tests, including four static guards
npm run build                 # typecheck and build both apps
npm run db:start -- status    # is the database up?
npm run db:start -- stop      # stop it
```

API documentation, generated from the implementation (API-011):
<http://localhost:3000/docs>

`db:setup` runs migrate, constraints and seed in order. `db:constraints` within
it is not optional. It adds the partial unique indexes that make
roll-number reuse correct (FR-REG-057), the check constraints, and the trigger
that makes the audit log genuinely append-only (FR-LOG-004). Prisma schema
cannot express any of them.

API docs (generated from the implementation, API-011): <http://localhost:3000/docs>

### Using a different database

`npm run db:start` is for local development. To point at a managed PostgreSQL —
Neon, Supabase, RDS — put its connection string in `DATABASE_URL` and run
`npm run db:setup` against it. Nothing else changes.

---

## Deploying it

```bash
cp .env.example .env
# POSTGRES_PASSWORD and LOCAL_STORAGE_SECRET have no defaults, and the stack
# refuses to start without them. Generate each:
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

docker compose up -d --build
```

Then open <http://localhost:8080>. The database starts **empty**, which is
deliberate — see below.

Three containers: PostgreSQL 16, the API, and nginx serving the built web app
on `WEB_PORT` (8080 by default). nginx proxies `/api` to the API internally, so
the browser sees one origin — the same arrangement the Vite dev proxy creates,
which is why CORS behaves identically in development and production.

On first start the API generates its signing keys into a volume, applies the 13
migrations, then applies the constraints and triggers. It does **not** seed: a
seed writes accounts whose passwords are published in this file. To get the
demonstration data anyway — on a machine where that is appropriate, and never
on the Institute's real server:

```bash
docker compose exec api npm run db:seed
```

Four things to know before it faces the internet:

- **Put TLS in front of it.** The stack speaks plain HTTP. Every password on it
  crosses the network in the clear otherwise.
- **If you add another proxy in front, raise `TRUST_PROXY_HOPS` to match.** It
  is how many hops the API trusts to report the client's address, and it is set
  to 1 for the nginx container. Too low and every request looks like it came
  from the proxy, so the rate limiter gives the whole Institute one shared
  budget and the security log sees a single client. Never replace it with a
  blanket "trust the header": a client can write anything into
  `X-Forwarded-For` and walk around the rate limit.
- **Do not run more than one API container.** `ActorService` caches each user's
  roles for 15 minutes in a per-process map (ARC-047). The purge issued when
  somebody's roles change reaches only the node that handled it, so on a second
  node a revoked permission keeps working for up to fifteen minutes.
- **The in-app backups are not database dumps.** They hold rows, not schema.
  Take host-level backups of the `postgres-data` volume as well.

Four named volumes, and all four matter. `postgres-data` is the Institute.
`api-storage` holds every uploaded file — payment slips, submissions, lesson
resources — because until DEP-01 lands the storage provider writes to local
disk; lose it and the rows survive pointing at files that are gone.
`api-keys` signs the access tokens, and losing it signs everybody out.
`api-backups` is self-explanatory.

Development does not need any of this — `npm run db:start` is a real
PostgreSQL with no Docker at all.

---

## Layout

```
packages/shared/     types, Zod schemas, enums, error codes, the §4.5 RBAC matrix
                     — defined ONCE and used by both tiers so the API contract
                       cannot drift between client and server (§3.11)

apps/api/
  prisma/schema.prisma   the §8 data model
  src/prisma/
    scope.extension.ts   ← ARC-051. Read this before writing any query.
    actor-context.ts     AsyncLocalStorage carrying the acting identity
  src/auth/              login, refresh rotation, step-up, actor resolution
  src/rbac/              ROLE ∩ ACTION guard + the §17.2 negative test suites
  src/audit/             the immutable log
  src/common/            envelope, error filter, correlation, validation
```

---

## The one thing to understand before contributing

Authorisation is **two independent halves**, enforced in two different places.
Conflating them is how systems leak student data.

```
ACCESS = ROLE ∩ ACTION        ∩   SCOPE
         └── PermissionsGuard      └── Prisma scope extension
             "may this user do          "on WHICH records?"
              this KIND of thing?"
```

- `src/rbac/permissions.guard.ts` answers the first, from the §4.5 matrix.
- `src/prisma/scope.extension.ts` answers the second, at the data layer, by
  injecting a `where` predicate into **every** query.

The scope half is applied centrally on purpose. ARC-051 forbids per-endpoint
scope filtering, because doing it by hand at 200 call sites guarantees one call
site eventually omits it — and that bug is invisible to every positive test.

**Consequences for you:**

- Never construct a bare `PrismaClient`. Use `PrismaService.scoped`.
- Adding a model? Add a policy to `MODEL_POLICIES`. A model with no policy is
  unscoped, which is right for reference data (Programme, Subject) and wrong
  for anything carrying student data.
- Need to bypass scope? There are exactly four legitimate reasons —
  authentication, registration provisioning, scheduled jobs, seeding. Use
  `prisma.asSystem()` so the bypass is visible at the call site. Anything else
  means the model's policy is wrong; fix it there.
- Changing roles, assignments, or enrolments? Call `ActorService.invalidate()`
  in the same transaction. ARC-047 and SEC-SES-009 require the change to take
  effect on the very next request, not after the cache expires.

## Tests

```bash
npm test
```

`src/rbac/permissions.spec.ts` implements the negative suites from §17.2 — the
tests that prove the System refuses what it must refuse (a teacher reaching a
payment slip, a student reaching another student's marks, an answer key leaking
mid-attempt). NFR-MNT-002 requires 100% coverage of authorisation logic; treat a
failure here as release-blocking.

Integration tests (`*.int-spec.ts`) need a live PostgreSQL and skip themselves
without one, so `npm test` stays green on a machine with no database:

```bash
DATABASE_URL=postgresql://... npm test
```

The most important test in the codebase is in `admission.int-spec.ts`: fifty
concurrent registration-number allocations must yield fifty distinct values
with no gaps. It is the only proof that RSK-07 is actually mitigated rather
than merely designed against — a read-then-write implementation passes every
other test in the suite and fails this one.

---

## Deviations from the SRS

Recorded rather than silently absorbed. Both are tooling-level and neither
changes the architecture.

| §3.11 says | Actually used | Why |
|---|---|---|
| pnpm workspaces | npm workspaces | pnpm not installed; functionally equivalent here |
| Docker Compose for local deps | Managed Postgres also supported | Docker not installed |

## Open items blocking later phases

From SRS Appendix H. Chase these now — they bite in weeks 4–8, not today.

| Ref | Needed for | By |
|---|---|---|
| OPN-01 | Registration number format + highest number already issued | Week 4 |
| DEP-01 / OPN-02 | Google service account + Drive API access | Week 8 |
| DEP-04 | Email provider + verified sending domain | Week 6 |
| DEP-06 | Hosting account and budget | Week 2 |
