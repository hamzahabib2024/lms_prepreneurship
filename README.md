# Online Learning Management System

Implementation of **SRS-LMS-001 v2.1** (`LMS_Software_Requirements_Specification.docx`).

Code comments cite the requirement they satisfy — `FR-REG-039`, `ARC-051`,
`SEC-AUZ-002` and so on. When changing behaviour, check the cited requirement
first: if the code and the SRS disagree, one of them is a defect.

---

## Status

**Phase 0 — Foundations.** The infrastructure that cannot be retrofitted safely
(§18.2). No business features yet, deliberately.

| Built | Not yet |
|---|---|
| Monorepo, TypeScript strict, build pipeline | Admission / registration |
| Prisma schema — core entities from §8 | Academic structure, enrolment |
| Auth: Argon2id, RS256 JWT, refresh rotation with reuse detection | Content, lectures, streaming |
| Per-role lockout, session limits, step-up (§4.6) | Live sessions, LCAL adapters |
| **The scope predicate (ARC-051)** | Attendance, assessment |
| RBAC guard wired to the §4.5 matrix | Reports, dashboards |
| Immutable audit log | Notifications |
| Response envelope, error model, correlation ids | Web client |

---

## Prerequisites

- **Node.js 20 LTS or later** (24 works)
- **PostgreSQL 16** — mandated by §3.11, not interchangeable. §8.4 needs partial
  and BRIN indexes and DB-017 needs native partitioning; MySQL has none of them.
- **Redis 7** — optional in development

## Setup

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL
npm run keys:generate         # RSA keypair for RS256 (SEC-AUT-005)
npm run db:generate           # Prisma client
npm run db:migrate            # create the schema
npm run dev                   # http://localhost:3000/api/v1
```

API docs (generated from the implementation, API-011): <http://localhost:3000/docs>

### Running the database

**With Docker** (not currently installed on this machine):

```bash
docker compose up -d
```

**Without Docker** — use a free managed Postgres such as [Neon](https://neon.tech)
or [Supabase](https://supabase.com), and paste the connection string into
`DATABASE_URL`. Nothing else changes. Redis is optional: with `REDIS_URL` unset
the app falls back to in-memory behaviour, which ARC-049 permits (the cache is a
performance aid, never a correctness dependency).

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
