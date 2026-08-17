# Running this on another machine

Everything needed to take a clone of this repository and get it working, and
what to do when it does not. Written after actually cloning it and running the
steps, not from memory — the failures below are ones that happened.

---

## Before you clone

**Push first.** A clone gets what is on the remote, not what is on the machine
you built it on. Check with:

```bash
git status
git log --oneline origin/main..main   # anything listed is NOT in a clone yet
```

---

## What you need installed

| | |
|---|---|
| **Node.js 20 or newer** | `node -v`. The build uses features 18 does not have |
| **Git** | to clone |
| **Nothing else** | no Docker, no PostgreSQL, no database server to install |

PostgreSQL comes with the project — a real PostgreSQL 16, downloaded on first
run and kept in `./pgdata`. That is why the first setup is slow and every one
after it is not.

---

## Two commands

```bash
git clone <your-repo-url>
cd lms_prepreneurship

npm ci          # NOT npm install — see below
npm run setup   # .env, signing keys, database, schema, sample data
npm start       # both servers
```

Then open **http://localhost:5173**

### Use `npm ci`, not `npm install`

`npm install` left a **partially installed** `node_modules` twice on a fresh
clone — packages present as empty directories, which surfaces much later as
`Cannot find package '.../node_modules/pg/index.js'` while starting the
database, and looks like a database problem rather than an install one.

`npm ci` installs exactly what `package-lock.json` says, deletes anything
already there, and completed cleanly. It is the right command for a fresh
clone anyway.

If you have already run `npm install` and something behaves strangely:

```bash
rm -rf node_modules      # Windows: Remove-Item node_modules -Recurse -Force
npm ci
```

### The first `npm run setup` is slow

It downloads a PostgreSQL 16 build (a few hundred megabytes) before it can
initialise anything. **Several minutes on a normal connection, and it looks
stuck while it happens.** Every run after that is seconds.

`npm run setup` is safe to run again — every step checks whether it is already
done and says so rather than failing.

---

## What a clone does and does not contain

| | | |
|---|---|---|
| Source, migrations, seed, scripts | **in the clone** | 318 files |
| `.env` | **not in the clone** | secrets are never committed (SEC-CRY-008). `npm run setup` creates it from `.env.example` |
| `keys/` | **not in the clone** | the RS256 signing keys. `npm run setup` generates a new pair |
| `pgdata/` | **not in the clone** | the database's own files, created on first run |
| `storage/` | **not in the clone** | uploaded coursework and recordings — student work |
| `node_modules/` | **not in the clone** | `npm ci` |

**A new machine gets a new signing key**, which means tokens issued on the old
machine are not valid on the new one. That is correct — a signing key that
travelled in a repository would be a signing key everybody has.

---

## Where things run

| | |
|---|---|
| http://localhost:5173 | the application |
| http://localhost:5173/home | the public page, as a visitor sees it |
| http://localhost:3000/api/v1 | the API |
| http://localhost:3000/docs | the API reference |
| localhost:5432 | PostgreSQL (`lms` / `lms` / database `lms`) |

**If port 5432 is already taken** by another PostgreSQL, set `PGPORT` and match
`DATABASE_URL` in `.env`:

```ini
DATABASE_URL=postgresql://lms:lms@localhost:5433/lms?schema=public
```

```bash
PGPORT=5433 npm run setup
```

---

## Signing in

`npm run setup` prints these at the end. They come from the seed and are
development credentials — SEC-CFG-002 forbids them in production.

| Role | Email | Password |
|---|---|---|
| Super Admin | `superadmin@institute.local` | `ChangeMe!SuperAdmin2026` |
| Administrator | `admin@institute.local` | `ChangeMe!Admin2026` |
| Teacher | `sana@institute.local` | `ChangeMe!Teacher2026` |
| Student | `ayesha1@student.local` | `ChangeMe!Student2026` |

---

## The database

**PostgreSQL 16**, run by the project itself through `embedded-postgres`. No
server to install, no Docker, no account anywhere.

- **54 tables** and 20 migrations. A fresh database reports 55 — the extra one
  is `_prisma_migrations`, which is how it knows which have been applied.
- 24 extra constraints and indexes applied on top, which is the number
  `db:constraints` prints
- Data lives in `./pgdata` — delete that directory and the next setup builds a
  fresh database from the migrations
- Constraints and indexes that Prisma cannot express live in
  `apps/api/prisma/sql/01_constraints_and_indexes.sql` and are applied by
  `npm run db:constraints`, which `setup` runs for you

Some rules are enforced by the database rather than by application code,
deliberately — code can be bypassed by the next caller and a constraint cannot:

- the audit log **cannot be updated or deleted**, by anybody, enforced by a
  trigger
- a **public announcement must be institute-wide** — a notice to one section
  cannot be published to strangers
- registration numbers are allocated by `INSERT … ON CONFLICT DO UPDATE
  RETURNING`, so two administrators approving at the same moment cannot be
  given the same number

### Useful commands

```bash
npm run db:start        # PostgreSQL only
npm run db:migrate      # apply migrations
npm run db:seed         # sample institute (safe to re-run)
npm run db:studio       # browse the data in a GUI
npm run db:setup        # migrate + constraints + seed
```

### Starting the data over

```bash
# stop everything first
rm -rf pgdata           # Windows: Remove-Item pgdata -Recurse -Force
npm run setup
```

---

## Checking it worked

```bash
npm test                # 1132 tests, 48 suites
npm run lint            # types + rules, expects zero errors
npm run build           # all three packages
```

```bash
node -r dotenv/config scripts/check-integrations.mjs   # what is connected
node -r dotenv/config scripts/check-email.mjs          # email specifically
```

---

## When something is wrong

**`Cannot find package '.../node_modules/pg/index.js'`** — an incomplete
install. `rm -rf node_modules && npm ci`.

**`P1001: Can't reach database server`** — PostgreSQL is not running.
`npm run db:start`. On Windows, killing Node processes broadly can take the
database supervisor with it.

**`EPERM … query_engine-windows.dll.node`** — the API is running and holding
the database engine open. Stop it, then run the command again.

**`EADDRINUSE`** — something is already on 3000 or 5173. Stop it, or change the
ports in `.env` and `apps/web/vite.config.ts`.

**The health endpoint says `degraded`** — expected. Redis and Google Drive are
optional and report `down` when unconfigured. The database line is the one that
matters.

---

## What the project is

An online Learning Management System for Prepreneurship, built against a
~1000-requirement IEEE 29148 specification.

| | |
|---|---|
| API | NestJS 10, TypeScript, Prisma |
| Web | React 18, Vite, plain CSS |
| Database | PostgreSQL 16 |
| Shared | one package of types, schemas and the permission matrix |

**Roughly 96% built.** 213 endpoints across 29 controllers, 37 screens, 54
tables, 1132 automated tests, 20 migrations.

A clone verified on 17 August 2026: cloned, `npm ci`, setup, 20 migrations
applied, 24 constraints applied, seeded 12 users, 4 programmes, 7 sections and
11 subjects. The `npm install` failure described above is what happened on the
way, not a hypothetical.

Read next:

| | |
|---|---|
| `README.md` | the architecture and why things are the way they are |
| `PROGRESS-REPORT.md` | a short report written for the company |
| `INTEGRATIONS.md` | connecting email, Google Drive, Meet and WhatsApp |
| `BEAUTIFICATION.md` | what every screen looks like and why |

### What is not finished

- **Google Drive and WhatsApp** need credentials from Prepreneurship. Both run
  in a clearly-marked simulated mode meanwhile — nothing pretends to have sent
  anything. `INTEGRATIONS.md` has the steps.
- **Email needs only a mailbox you already own**, and is the one worth doing
  first.
- **A screen-reader audit has not happened.** Contrast is measured and the
  mechanical checks pass; whether a screen makes sense read aloud needs a
  person.
- **Performance was measured on a laptop** — 165 req/s, and it should be
  re-measured on the real server.
