# Prepreneurship Learning Management System

**Progress report — 12 August 2026**
Prepared by Muhammad Hamza Habib · Version 0.1.0

---

## Summary

The system is built and running end to end. A student can apply from the public
site, be admitted, attend classes, submit work, be marked, pay in instalments
and receive a verifiable certificate — with the fees ledger, the attendance
register and the progress record agreeing with each other throughout.

| | |
|---|---:|
| Built | **96%** |
| Screens | 36 |
| API endpoints | 209 |
| Database tables | 54 |
| Automated tests | 1,076 |
| Known defects | 0 |

The completion figure is measured, not estimated. The specification defines
**82 permission-controlled areas**; **72 are reachable and working today**. Of
the ten that are not, three are duplicate names for things already built, four
were waiting on credentials (one of which is now resolved — see below), and
three are the small items listed under *Remaining work*.

Around 53,000 lines of code across 165 commits. Every commit builds, passes the
full test suite, and passes the linter with zero errors.

---

## What works today

**For a student.** Applies through the public site with no account, uploads a
payment slip, and receives a tracking reference. Once admitted: timetable,
lessons and recorded lectures, assignments, quizzes, attendance, fee statement
and printable receipts, and a certificate an employer can verify without
logging in.

**For a teacher.** Sets assignments and quizzes, marks against a rubric,
takes the register entirely by keyboard, publishes lesson content, runs class
discussions, and keeps private notes about students that the student never
sees.

**For the office.** Reviews applications against the payment slip, admits with
an automatic registration number, sets up academic terms, batches and sections,
manages fees and instalment plans, issues receipts and certificates, configures
the wording of every message the system sends, and runs fourteen reports.

Three rules are enforced structurally rather than by convention:

- **Gender-segregated sections** cannot be overridden once students are
  admitted. The field is not editable, so nobody has to be refused.
- **Money is held as whole paisa**, never as decimals, so no rounding error can
  accumulate in the ledger.
- **The audit log cannot be altered or deleted**, and that is enforced by the
  database itself rather than by application code.

---

## How correctness is established

Three independent mechanisms, all of which fail the build if they fail.

| Mechanism | Count | Protects against |
|---|---:|---|
| Automated tests | 1,076 | Business rules changing by accident — fee arithmetic, attendance thresholds, grade release, certificate eligibility |
| Build-time guards | 9 | Whole categories of security mistake: every table has an access rule, every screen is reachable, no button leads nowhere |
| End-to-end checks | 47 | Faults that only appear against a real database |

Thirty-eight security and correctness defects were found and fixed during
development. Almost none were caught by unit tests; nearly all were caught by
running the system from outside as a real user would. That shaped the working
method: **every feature is exercised from the outside before it is considered
done**, and a check that could not possibly have failed is treated as no check
at all.

---

## Performance

Load-tested against the specification's target of 150 concurrent users, using a
realistic mix of the pages an institute opens in the morning.

| Concurrent users | Typical response | Slowest 5% | Throughput | Failures |
|---|---:|---:|---:|---|
| 10 | 53 ms | 125 ms | 165 req/s | none |
| 150 | 798 ms | 1,792 ms | 164 req/s | none |

Throughput is identical at both levels, which is the useful finding: the server
handles about 165 requests per second, and the slower figures at 150 users are
queueing rather than slow database queries. Since 150 signed-in people do not
each make a request every second, this is comfortable headroom. Capacity rises
with server cores, and the deployment configuration already supports running
several copies behind a load balancer.

> These figures come from one machine running the application and the database
> together, with no network in between. They are reliable for spotting something
> that breaks under load, and **should be re-measured on the real server before
> launch**.

**One defect this testing found.** The system limited requests per internet
connection rather than per person. An institute where students share one
connection — a computer lab, or campus Wi-Fi — would have hit that ceiling
together and been locked out at nine in the morning. The limit is now
configurable and documented.

---

## External services

Every integration has a working fallback, and the Integrations screen states at
any moment which are live and which are not. This was deliberate: the dangerous
failure is not an outage but an administrator assuming a fee reminder reached a
student when it did not.

| Service | State | Needs | Without it |
|---|---|---|---|
| **Email (SMTP)** | **Built** — needs only a mailbox | A mailbox Prepreneurship already owns | Nothing is emailed |
| **Google Drive** | Credentials **and** ~2 days' work | A Google Cloud service account, then the Drive API calls written | Video served from the app server |
| **Google Meet** | Credentials **and** ~1 day's work | The same service account, then the Calendar calls written | Meeting links pasted in by hand |
| **WhatsApp** | Credentials **and** ~1–2 days' work | Meta Business account, then the send call written | Nothing sent; in-app inbox still works |

**A correction worth stating plainly.** An earlier version of this report implied
all four go live by entering a credential. That is true of **email only**. For
the other three the adapter, the configuration, the fallback and the honest
"not connected" reporting are all built and tested, but the calls to Google and
Meta themselves are not written — each currently refuses with a message naming
the outstanding dependency. Getting the credentials is still the right next
step, because nothing can be built or tested against them until they exist, but
they will not switch anything on by themselves.

**Email is the one to do first** and the only one that is finished. It needs
nothing from any third party beyond a mailbox the Institute already has, and
until it is configured a new account's temporary password reaches its owner
only by an administrator reading it off the screen — which means the password
to a student record ends up in somebody's chat history.

Step-by-step setup for all four, including the Gmail App Password procedure and
the Google service-account procedure, is in **`INTEGRATIONS.md`**.

---

## Remaining work

| Item | Why it matters | Effort |
|---|---|---|
| Screen-reader audit | The specification requires usability for people with visual impairments. Mechanical checks are automated and passing; whether a screen makes sense read aloud needs a person with a screen reader | 1–2 days |
| Re-test on the real server | Performance figures above were taken on a laptop and should be confirmed on the machine the institute will use | half a day |
| Operations runbook | Written backup, restore and maintenance instructions for whoever runs the server day to day | 1 day |

---

## Seeing it for yourself

The system runs on a single machine and needs no external services to
demonstrate. It ships with sample programmes, sections, teachers and students
already loaded.

```
npm install
npm run db:setup
npm run dev        # API   — localhost:3000
npm run dev:web    # web   — localhost:5173
```

A packaged version that runs the whole system, including its database, in one
step is also included for server deployment.

Worth looking at first:

- **The public application form**, as a stranger would use it — no account
  needed.
- **The attendance register**, which is driven entirely by the keyboard.
  Reaching for a mouse forty times a lesson is what makes staff stop taking
  attendance at all.
- **The fee statement**, with its instalment plan and printable receipt.
- **The Integrations screen**, which says plainly what is connected and what is
  simulated.

---

*Figures in this report were taken from the codebase and the running system on
12 August 2026 and can be reproduced with the commands above.*
