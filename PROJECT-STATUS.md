# Project status

Last updated: 10 August 2026 (user management screen, audit log viewer, rubrics)

**Roughly 72–75% of the SRS scope is built.**

That figure is an estimate, not a measurement, and it is worth saying what it
rests on. The SRS defines around a thousand numbered requirements; nobody has
walked all of them one by one. What has been counted is: 48 database models, 134
endpoints across 15 controllers, 20 web pages, 475 automated tests, and 12
end-to-end probes. What the estimate weighs against that is the §4.5 permission
matrix, which names 82 resources — **48 are reachable by an endpoint today and
34 are not.**

The shape of the gap matters more than the number:

- **The student's journey is essentially complete.** Apply, be admitted, attend,
  watch lectures, submit work, sit a quiz, be marked, be warned when attendance
  slips, earn a certificate, have an employer verify it.
- **The teacher's journey is complete.** Set assignments and quizzes, build
  course content, take the register, mark, grade, announce, and see who is at
  risk — all from a screen.
- **The administrator's journey is half built.** Admissions, certificates, user
  management and audit viewing now have both an API and a screen. Settings,
  bulk operations, impersonation, maintenance mode and backup have neither.
- **The two external integrations are stubs by necessity** — no credentials
  exist yet (DEP-01, DEP-04). Both sit behind adapters, so each is one file when
  the credentials arrive.

---

## Done

### Foundations
- [x] Modular monolith: NestJS 10, Prisma 5, PostgreSQL 16, Vite + React 18
- [x] TypeScript strict throughout, including `noUncheckedIndexedAccess`
- [x] Local PostgreSQL with no Docker and no admin rights (`npm run db:start`)
- [x] 8 migrations, 48 models, hand-written constraints for what Prisma cannot express
- [x] Deterministic seed: people, structure, content, assignments, a quiz, a marked register

### User administration
- [x] Directory of every account, with roles and sub-permissions
- [x] Provision a teacher or an administrator; temporary password shown once
- [x] Suspend and reactivate — BR-ACC-02 protects the last Super Admin
- [x] Reset a password; revoke every session
- [x] Grant sub-permissions (Super Admin, with step-up)
- [x] **People screen** — directory, provisioning, suspension, password reset.
      The temporary password is a persistent panel, not a toast: it is
      Argon2id-hashed at creation and genuinely cannot be shown again.

### Audit and accountability
- [x] Every privileged action written immutably, with a correlation id
- [x] Database triggers refuse UPDATE and DELETE on the log (FR-LOG-004)
- [x] **Audit viewer** — API and screen. A Super Admin sees everything; an
      Admin sees only their own actions (§4.5.12), because an administrator
      reading colleagues' actions is surveillance, not administration.
- [x] The history of one record, and everything done in one request
- [x] Changes rendered as before → after, not as a bare action name

### Authentication and authorisation
- [x] RS256 JWT with refresh-token rotation and family invalidation (SEC-AUT-004)
- [x] Argon2id hashing, timing-equalised login (SEC-AUT-009)
- [x] Forced password change on a provisioned account (FR-REG-040)
- [x] The §4.5 matrix as executable data — 85 resources, 4 roles, 4 sub-permissions
- [x] ARC-051 scope predicate: one Prisma extension, no per-endpoint filtering
- [x] **Three static guards** that fail the build rather than trusting review:
  - every model is policed or explicitly named as reference data
  - every nested include of a policed model restates its restriction
  - every create naming a scope-bearing id checks it

### Admission
- [x] Public application, no account needed; campaign attribution captured from the link
- [x] Review queue with claim/release so two administrators cannot collide
- [x] Approve, reject, request more information
- [x] Atomic registration-number allocation, safe under concurrency (RSK-07)
- [x] **One student, one number, one or many courses** — a returning student keeps
      their number, account and password, and gains a roll number per section
- [x] Public status lookup by tracking reference

### Academic structure
- [x] Programmes, sessions, batches, sections, subjects, offerings
- [x] Gender-restricted and shift-based sections (FR-CRS-007/009)
- [x] Teacher assignment to a subject WITHIN a section (BR-ACC-04)
- [x] Enrolment, transfer, suspend, withdraw, reinstate

### Content and lectures
- [x] Modules, lessons, recorded lectures, publication workflow (BR-CNT-01)
- [x] Storage abstraction (ARC-043) with a local provider that signs URLs properly
- [x] Playback tickets: short-lived, user-bound, never a storage identifier (ARC-039/041/052)
- [x] Watch progress from MERGED intervals, so replaying the opening earns nothing
- [x] Resume where the student stopped
- [x] Content authoring screen: modules, lessons, cataloguing from storage,
      publication at every level

### Live classes and attendance
- [x] LCAL provider abstraction (ARC-023/028) — no vendor named outside an adapter
- [x] Scheduling, join routes, fallback links
- [x] Keyboard-driven register: a 40-student class in under a minute (FR-ATT-007)
- [x] Corrections with reason and audit
- [x] **Attendance warnings raised on escalation, not on every register**
- [x] Teacher's at-risk list, worst-first; acknowledgement that does not clear

### Assessment
- [x] Assignments: windows, hard close, late policies, resubmission policies
- [x] File upload validated by CONTENT, not by extension
- [x] Submission, per-student files, ownership enforced at the database
- [x] Grading with System-computed late penalties (BR-ASG-03)
- [x] Cohort grade release (FR-ASG-028); internal notes never reach a student
- [x] Assignment builder: windows, late policy, file policy, resubmission
- [x] Quizzes: attempts, resume with the same paper, auto-marking, manual marking
- [x] Four result-release policies, all four now honoured
- [x] **Quiz authoring**: question banks, eight question types with per-type
      validation, papers, publication that refuses an incoherent quiz
- [x] Quiz builder screen: type-driven composer, paper assembly, publish
- [x] **Rubrics**: authoring, reuse across assignments, institute-wide sharing,
      per-criterion levels, fit check against an assignment's total
- [x] Internal criteria (FR-ASG-014) never reach a student — not the marks,
      not the names, not the fact that any exist
- [x] Rubric scores validated on the way in; a rubric already used to mark
      cannot be edited out from under the marks that depend on it

### Progress and certificates
- [x] Weighted progress with redistribution when a component is absent (BR-PRG-03)
- [x] Completion criteria per offering, with outstanding items named
- [x] Certificates: earned not granted, snapshot evidence, revocation, reissue
- [x] Public verification with no account and a minimal projection

### Communication
- [x] Announcements addressed to an AUDIENCE, resolved at send time
- [x] Per-user inbox as the system of record
- [x] Preferences: channels, muted kinds, quiet hours that wrap midnight
- [x] Channel adapter registry; WhatsApp is one file away

### Reporting
- [x] Role-specific dashboards, decided server-side
- [x] 5 reports: student directory, attendance summary, registration pipeline,
      revenue, acquisition attribution
- [x] CSV export with injection defence and a UTF-8 BOM for Excel

---

## Remaining

### Blocked on you, not on code
- [ ] **DEP-01** — Google Drive credentials. Storage runs on the local provider;
      swapping is one adapter.
- [ ] **DEP-04** — Meta/WhatsApp Business credentials. The whole notification
      pipeline runs today and records deliveries; the adapter logs instead of
      sending and never claims success.

### Administrator surface (the largest gap)
- [ ] System settings (thresholds, weights, templates are configurable but have no screen)
- [ ] Security event log viewer (the audit log now has one; this is the other log)
- [ ] Bulk operations (import, bulk enrolment change)
- [ ] Impersonation with its audit trail
- [ ] Maintenance mode
- [ ] Backup and restore
- [ ] Personal data export and permanent deletion (SEC-PRV)

### Authoring screens (endpoints exist, no interface)
- [ ] Section and offering management beyond the read-only list

### Not started at all
- [ ] Rubric authoring SCREEN (the API is done; nothing in the web app reaches it)
- [ ] Lesson resources — files attached to a lesson, separate from lectures
- [ ] Timetable
- [ ] Discussion posts
- [ ] Self check-in (FR-ATT-008) — the permission is split out and ready
- [ ] Payments beyond the admission verification: instalments, receipts, ledger
- [ ] Programme-level certificates (subject-level works)
- [ ] Notification templates and institute-level configuration

### Reports
- [ ] Progress, assessment, enrolment, teacher-activity and marketing reports
      (5 of the ~10 the SRS names are built)

### Quality and operations
- [ ] Playback tickets are in memory — must move to Redis before a second instance
- [ ] No CI pipeline
- [ ] No load testing against NFR-PRF targets
- [ ] Accessibility verified by construction, not yet audited with a screen reader
- [ ] No deployment configuration or runbook

---

## How the work has actually gone

Worth recording, because it shapes what to expect from the remainder.

Fifteen security defects have been found and fixed, and **the permission
matrix was correct in every one of them.** What went wrong each time was a resource
named after a *topic* — "attendance", "progress", "submission" — attached to
endpoints serving very different audiences under it. Two more came from
structural limits of the scope predicate: it does not filter nested includes,
and it does not constrain creates. Both are now documented where the next person
will look, and both have a static guard.

The fifteenth had a mechanism the other fourteen did not. A student's rubric
breakdown came from a JSON column, and a JSON column is invisible to every
structural defence at once: the scope predicate filters rows, `select` narrows
columns, and both static guards read the Prisma schema — to all of them the
field is one opaque value. Half of it did have a structural answer that was not
being used (`isInternal` is row state, so `RubricCriterion` now has a policy);
the other half can only be enforced in application code, which is why those
rules sit in a pure module with 45 tests rather than inline in a service.

**The lesson has been the same every time: nearly every defect was found by
running the code against a real database, not by reading it.** The 475 unit
tests have never caught one. The twelve end-to-end probes caught all fifteen.
