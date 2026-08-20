# Project status

Last updated: 20 August 2026 (lecture folders, uploads, and a dashboard you can act on)

**Roughly 96% built, and that figure has arithmetic behind it.**

Measured rather than estimated. The §4.5 permission matrix names **82
resources**, and **72 are reachable by an endpoint today** — 88%. That is the
hardest number available, but it understates the position, because three of the
ten that are unreachable are naming overlaps rather than missing work:
account management exists and is guarded by `user_directory`, `teacher_account`
and `account_state`, so `admin_account`, `student_account` and
`super_admin_account` are unused synonyms for things that are built.

Of the remaining seven: **three are blocked on credentials you have to supply**
(`provider_binding`, `whatsapp_link`, `participation_evidence`), and the rest
are naming overlaps for things now built — the registration-number format and
internal notes were closed on 12 August, and the payment-slip resource is what
the admission flow already handles under another name.

Weighing that against the rest: 54 models, 209 routes across 29 controllers,
36 web pages, 1,076 automated tests, 17 migrations and 47 end-to-end probes.

**What the 4% is.** Most of it is the externally blocked items — now three
rather than four, because email no longer waits on anybody. The rest is: the
screen-reader audit, re-measuring performance on the real server, and an
operations runbook.

**Email is built and needs nothing from Google or Meta.** SMTP with an app
password, which any mailbox the Institute already owns can provide. This was
the largest practical gap in the system and it was invisible: a new account's
temporary password is shown once on screen, and until now the only way it
reached its owner was an administrator reading it out — so the password to a
student record ended up in somebody's chat history. See INTEGRATIONS.md.

**One caveat on the 88%, worth stating because the number is the argument.**
It counts resources a route mentions. Nothing yet checks the reverse — a
resource the matrix grants that no route ever names — which is exactly how
`academic_session` and `batch` sat at FULL-for-Admin with zero endpoints while
`POST /sections` quietly required a batchId nobody could obtain. That reverse
guard does not exist, so the ten unreachable resources above are counted by
hand rather than enforced by the build.

**The UI is no longer plain.** Four passes: a design system with tokens, dark
mode and a sidebar grouping twenty-one destinations by what somebody is doing;
skeletons, empty states and progress rings; a public landing page and
application form with drawn rather than photographed backgrounds; and the
attendance register, which a teacher uses every session. It is branded
Prepreneurship throughout.

What remains of the UI is the admin tables — People, Audit, Security, Sections
— which inherit the tokens so they look consistent, but nobody has designed
them. They are also the screens used least often by the fewest people, which is
why they are last.

The shape of the gap matters more than the number:

- **The student's journey is essentially complete.** Apply, be admitted, attend,
  watch lectures, submit work, sit a quiz, be marked, be warned when attendance
  slips, earn a certificate, have an employer verify it.
- **The teacher's journey is complete.** Set assignments and quizzes, build
  course content, take the register, mark, grade, announce, and see who is at
  risk — all from a screen.
- **The administrator's journey is essentially complete.** Admissions,
  certificates, user management, audit viewing, settings and the security log
  have both an API and a screen. Impersonation, personal data export and
  erasure, maintenance mode and bulk operations have APIs, verified end to end;
  and all of them now have screens, including backup and restore.
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

### Governance and operations
- [x] **Institute settings**: a declared catalogue, not a key-value store —
      a misspelled key is refused rather than saved and never read. Attendance
      thresholds and progress weights were environment variables and code
      constants; they are now the Institute's to change, overridable per
      programme, section or subject, with the source of each value shown
- [x] **Impersonation** (SEC-AUZ-013): Super Admin with step-up, 15 minutes, no
      refresh token, no nesting, no Super Admin target, and no credential
      changes from inside — the rule that stops it becoming account theft
- [x] **Personal data export** — a student's own by right; what they receive
      respects BR-ASG-09, an administrator's copy is complete
- [x] **Erasure**: anonymisation, not deletion, because the audit log is
      append-only and certificates must stay verifiable. One policy list with a
      reason per category, shown before anything is pressed
- [x] **Maintenance mode**: a Super Admin is never refused and signing in is
      never refused, so turning it on cannot lock out whoever turns it off
- [x] **Cohort import**: a spreadsheet of students an Institute already has,
      loaded into a section. It is NOT an application and refuses to pretend to
      be: no consent checkbox is written on anybody's behalf — the operator
      asserts it was collected offline and that assertion is what is audited —
      and no payment is invented, so an imported student simply owes the full
      amount, which is true. One transaction per student, so row 297 cannot
      roll back the 296 before it
- [x] Import screen: previewing is the only path to the button, problems are
      listed by SPREADSHEET row number, and the temporary passwords download as
      a file — because nobody copies three hundred one at a time — with the
      panel saying plainly that the file is live credentials
- [x] **Bulk transfer and withdrawal**: every row goes through the ORDINARY
      operation, so a batch cannot bypass the gender restriction or capacity.
      Not all-or-nothing, and the report says so
- [x] **Backup and restore**: a DATA backup (not a pg_dump — the embedded
      Postgres ships no pg_dump at all), verified the moment it is taken and
      re-verifiable at any time. Restoring needs step-up, an exact confirmation
      phrase and maintenance mode. The AUDIT LOG is backed up and never
      restored over: a restore that could reload an older copy of it would let
      somebody erase the record of what they did
- [x] Backup screen: blockers named rather than greyed out, and the panel's
      conditions checked against the ones the server actually refuses on
- [x] **Unlock an account** without resetting its password
- [x] **Self check-in** (FR-ATT-008), recorded as self-reported so a register
      never renders it identically to a teacher's own mark
- [x] **Screens for all of it**: acting as a user, exporting and erasing a
      record, unlocking an account, and bulk changes with preview first
- [x] **Step-up re-authentication in the interface** — it had none, so four
      operations were correct, verified and unusable

### Audit and accountability
- [x] Every privileged action written immutably, with a correlation id
- [x] Database triggers refuse UPDATE and DELETE on the log (FR-LOG-004)
- [x] **Audit viewer** — API and screen. A Super Admin sees everything; an
      Admin sees only their own actions (§4.5.12), because an administrator
      reading colleagues' actions is surveillance, not administration.
- [x] The history of one record, and everything done in one request
- [x] Changes rendered as before → after, not as a bare action name
- [x] **Security log viewer**: leads with a judgement rather than rows —
      664 of 674 events are ordinary sign-ins. Distinguishes an account being
      targeted from a password spray from address probing, because each needs a
      different response, and carries the advice with each

### Authentication and authorisation
- [x] RS256 JWT with refresh-token rotation and family invalidation (SEC-AUT-004)
- [x] Argon2id hashing, timing-equalised login (SEC-AUT-009)
- [x] Forced password change on a provisioned account (FR-REG-040)
- [x] The §4.5 matrix as executable data — 85 resources, 4 roles, 4 sub-permissions
- [x] ARC-051 scope predicate: one Prisma extension, no per-endpoint filtering
- [x] **Eight static guards** that fail the build rather than trusting review:
  - every model is policed or explicitly named as reference data
  - every nested include of a policed model restates its restriction
  - every create naming a scope-bearing id checks it
  - every guarded route names a real resource, a real action, and a pair some
    role can actually satisfy
  - nothing calls findUnique on the scoped client — the injected predicate is
    an AND, findUnique takes only unique fields, and the combination throws for
    every role that IS scoped while working for a Super Admin
  - every setting the code READS is declared in the catalogue, so a key nobody
    can set cannot sit behind a default forever
  - every web page is ROUTED, every routed page is imported, and every internal
    link has a route — because an unrouted page compiles perfectly and simply
    cannot be reached
  - every class a page uses is DEFINED in the stylesheet — an unknown class is
    silently nothing in CSS, and the redesign dropped thirty-one of them

### Admission
- [x] **The public application works end to end** — prospectus, slip upload,
      submit, status by tracking reference — and the reviewer can open an
      application and LOOK AT THE SLIP. Three separate faults had made it
      unsubmittable by anybody, and a fourth meant the slip could not be read
      back; all four are fixed and proved from outside with no account
- [x] No slip attached is shown as a WARNING rather than an empty space,
      saying plainly not to approve on the claimed amount alone
- [x] **A public landing page** whose programmes are REAL — served from a new
      `/public/prospectus`, so a closed programme stops being advertised the
      same afternoon. It says less than it could: no capacity, no enrolled
      counts, no teacher names, because "3 places left" is a pressure tactic
      and "0 places left" tells a competitor more than an applicant
- [x] Nothing on it is invented: no student numbers, no testimonials, no
      "trusted by thousands" — a page that overclaims makes a reader doubt the
      things that are true
- [x] Public application, no account needed; campaign attribution captured from the link
- [x] Review queue with claim/release so two administrators cannot collide
- [x] Approve, reject, request more information
- [x] Atomic registration-number allocation, safe under concurrency (RSK-07)
- [x] **One student, one number, one or many courses** — a returning student keeps
      their number, account and password, and gains a roll number per section
- [x] Public status lookup by tracking reference

### Academic structure
- [x] Programmes, sessions, batches, sections, subjects, offerings
- [x] **Terms and batches are now creatable through the interface.** This line
      used to sit inside the one above it and was not true: the models existed
      and were seeded once, but no route listed or created either, so the
      batchId that `POST /sections` requires could not be obtained by any
      caller. An Admin opening a new intake could not create the term, the
      batch, or therefore the section. `/structure` and six routes close it
- [x] Gender-restricted and shift-based sections (FR-CRS-007/009)
- [x] Teacher assignment to a subject WITHIN a section (BR-ACC-04)
- [x] Enrolment, transfer, suspend, withdraw, reinstate

### Content and lectures
- [x] Modules, lessons, recorded lectures, publication workflow (BR-CNT-01)
- [x] Storage abstraction (ARC-043) with a local provider that signs URLs properly
- [x] Playback tickets: short-lived, user-bound, never a storage identifier
      (ARC-039/041/052), and held in the DATABASE — a ticket survives a restart,
      so a second instance no longer refuses half of all playback
- [x] Watch progress from MERGED intervals, so replaying the opening earns nothing
- [x] Resume where the student stopped
- [x] Content authoring screen: modules, lessons, cataloguing from storage,
      publication at every level
- [x] **Lesson resources**: handouts and worksheets attached to a lesson, with
      TWO publication gates — the resource's own status and the lesson's, so
      uploading never publishes and a published handout in a draft lesson
      stays invisible. Attached beside the recording on the teacher's screen,
      downloaded as bytes on the student's — never as a forwardable URL

### Live classes and attendance
- [x] LCAL provider abstraction (ARC-023/028) — no vendor named outside an adapter
- [x] Scheduling, join routes, fallback links
- [x] Keyboard-driven register: a 40-student class in under a minute (FR-ATT-007)
- [x] Corrections with reason and audit
- [x] **Attendance warnings raised on escalation, not on every register**
- [x] Teacher's at-risk list, worst-first; acknowledgement that does not clear
- [x] **Timetable**: a weekly pattern expanded into classes, each created
      through the ORDINARY scheduler so a term cannot double-book a teacher
      thirty times, with holidays excluded and days grouped by LOCAL date
- [x] Timetable screen, leading with the next class in words rather than a grid

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
- [x] **Programme certificates**: completion is RECOMPUTED for every compulsory
      subject at the moment of issue rather than inferred from whether subject
      certificates were printed — so the document attests to the student's work
      and not to the Institute's paperwork. A student with no enrolments is
      refused explicitly, because zero subjects are all vacuously complete and
      `every()` over an empty list is how somebody who never attended is handed
      a qualification
- [x] A refusal names each gap subject by subject, so "when will I get my
      certificate?" has an answer; `programmeStanding` gives the same answer
      read-only, and a student may read their own
- [x] Weighted progress with redistribution when a component is absent (BR-PRG-03)
- [x] Completion criteria per offering, with outstanding items named
- [x] Certificates: earned not granted, snapshot evidence, revocation, reissue
- [x] Public verification with no account and a minimal projection

### Communication
- [x] **Notification templates** — a declared catalogue of the messages the
      Institute can word itself, each naming the placeholders it can fill. A
      misspelled placeholder is refused ON SAVE, because a message goes out
      once to a person and "Dear {studentNmae}" cannot be recalled
- [x] Rendering NEVER emits a brace: a missing value collapses and what it
      leaves behind — empty quotes, doubled spaces, a stranded full stop — is
      tidied. Zero is not treated as missing, and a value containing braces is
      not re-rendered
- [x] Stored only where the wording has actually been CHANGED, so the Institute
      can tell which messages it has edited; resetting deletes the override
      rather than freezing a copy of the default
- [x] Announcements addressed to an AUDIENCE, resolved at send time
- [x] Per-user inbox as the system of record
- [x] Preferences: channels, muted kinds, quiet hours that wrap midnight
- [x] Channel adapter registry; WhatsApp is one file away
- [x] **Discussion posts**: a question thread per offering, one level of
      replies enforced by a database trigger, edits marked so a thread stays
      readable, and a removed question kept as a tombstone so its answers do
      not become replies to nothing

### Fees
- [x] **The fee ledger**: charges, waivers, statements, aging, and who owes
      what. Student.outstandingBalance existed from the first migration with
      nothing writing to it, so every student's exported record said they owed
      nothing and the erasure refusal could never fire
- [x] A reversed payment and a waived charge are SHOWN, not removed — a student
      holding a receipt must find both lines
- [x] The materialised balance is recomputed only inside the transaction that
      changed the ledger, and `reconcile` proves it: "All 8 balances already
      agreed with the ledger"
- [x] **Fee screen**: the debtor list for staff, their own statement for a
      student, and step-up asked for on the way IN — reading fees needs it too

### Reporting
- [x] Role-specific dashboards, decided server-side
- [x] 14 reports: student directory, attendance summary, registration pipeline,
      revenue, acquisition attribution, progress and completion, assessment
      status, teacher activity, fee defaulters by age of debt, collection
      summary by day, section roster, **students at risk**, **certificate
      register**, **enrolment changes**
- [x] Students at Risk gives REASONS rather than a score — "risk 0.62" tells
      nobody what to say when the call is answered — and counts overdue money
      rather than outstanding, so a student with an instalment due next month
      is not on a list of people in trouble
- [x] The certificate register does NOT export verification codes: the code is
      unguessable so only somebody holding the document can check it, and a
      spreadsheet of them hands that to whoever receives the file
- [x] Fee defaulters is sorted by the AGE of the debt rather than its size, and
      its four aging buckets add up to the outstanding figure — so the number
      can be checked by hand rather than trusted
- [x] The collection summary counts reversals SEPARATELY rather than
      subtracting them, because the point of it is reconciling against a
      deposit slip and the bank saw the money arrive
- [x] A teacher running the teacher-activity report gets exactly one row —
      their own. Enforced in the service, because the report aggregates across
      six models and no per-model predicate decides who appears in the output
- [x] CSV export with injection defence and a UTF-8 BOM for Excel, carrying a
      preamble that records the filters applied and the row count — which is
      what lets an exported report be reconciled months later
- [x] **Filters declared by the report, not assumed by the screen.** Each
      definition says which it accepts, of what type, and which are required;
      the page renders exactly those. The roster's section is required and is
      refused rather than defaulted, because returning every student would be
      the wrong answer wearing the right name

---

## Remaining

### Blocked on you, not on code
- [ ] **DEP-01** — Google Drive credentials. Storage runs on the local provider;
      swapping is one adapter. Meet needs the same service account plus the
      domain-wide delegation step, which INTEGRATIONS.md spells out.
- [ ] **DEP-04** — Meta/WhatsApp Business credentials. The whole notification
      pipeline runs today and records deliveries; the adapter logs instead of
      sending and never claims success.
- [x] **Email is no longer on this list.** It needed nothing from Google or
      Meta — SMTP with an app password from any mailbox the Institute owns —
      and it was the gap that actually mattered day to day. The EMAIL channel
      had been in the enum since the notification layer was written with no
      adapter behind it, so a temporary password shown once on screen could
      only reach its owner by an administrator reading it out

### Authoring screens (endpoints exist, no interface)
- [x] Section and offering management — done 12 August, from the sections list
      itself, with the subjects panel and archive

### Marking
- [x] Each row of work was two spans with no layout, so the title and its state
      stacked and a teacher scanning for "what needs marking" read every line
      twice. They are a row now, and every state is a word with colour as a
      second signal
- [x] "Marked, not released" is shown as OUTSTANDING rather than as neutral
      text — it is the state a teacher forgets, and marked work nobody can see
      is work the student is still waiting for

### The register
- [x] **Redesigned for the person using it** — a progress bar readable across a
      desk, because a teacher calling thirty names wants to know they are at
      nineteen without counting; a whole cell as the hit target rather than a
      twenty-pixel radio, because one you have to aim at is one you miss while
      looking at the room. The radio semantics and the keyboard shortcuts are
      untouched: they are the best thing about the screen

### Not started at all
- [x] **The public application form.** Four separate faults had made this path
      unwalkable; a stranger can now read the prospectus, apply in four steps,
      attach a payment slip and get a tracking reference, with no account

- [x] **Terms and batches** — create, edit, filter, with the status rules that
      stop a batch being added to a term that has already finished
- [x] **Section create, edit, archive and subjects**, from the list itself. No
      delete anywhere: archived, never removed (FR-CRS-013, BR-DAT-04). The
      gender restriction is not editable, because FR-CRS-009 is absolute and a
      field that can only be refused should not be offered
- [ ] Programme-level certificates need a screen once the API exists

### Reports
- [x] **Fourteen.** Eight carry SRS numbers; six are named for what they do,
      chosen by what an institute keeping a ledger and a register asks for.
      The SRS's own numbered list is not available to this repository and you
      do not have it either, so inventing citations would have put a false
      reference in the code. If the list turns up, the gap is a comparison
      rather than a rebuild — each report is one `register()` call.

### Quality and operations
- [x] **Load tested against NFR-PRF.** 165 req/s, p95 125ms at 10 concurrent
      and 1,792ms at 150 — the SAME throughput at both, so the latency at 150
      is queueing rather than slow queries. `scripts/load-test.mjs`, with the
      numbers in its header so a regression is visible
- [x] It found a defect worth the whole exercise: the request ceiling was per
      client ADDRESS, so an institute whose students share one connection —
      a lab, campus Wi-Fi — would have been locked out together at nine in the
      morning. `THROTTLE_LIMIT_PER_MINUTE` now exists
- [x] **Accessibility, as far as a static check goes.** Six checks over every
      screen; three real defects fixed, the largest being 60 of 66 error
      alerts with no `role`, so a validation failure was silent to a screen
      reader
- [ ] **The screen-reader audit itself.** Still not done, and it now also has
      to cover input labelling: two static checks for that were written and
      both were wrong — one accused five files that were correct, the other
      eight. Deciding whether a control has an accessible name needs the
      rendered accessibility tree, not a regex over JSX, so the check was
      removed rather than given an exception list
- [ ] Re-measure performance on the real server. The figures above are from a
      laptop sharing a CPU with PostgreSQL
- [ ] An operations runbook beyond the README's deployment section
- [x] **Two reports for the company.** `PROGRESS-REPORT.md` in the repo and a
      web version, both with figures taken from the codebase rather than
      estimated, and both stating that the load numbers came from a laptop
- [x] **`INTEGRATIONS.md`** — how to connect email, Drive, Meet and WhatsApp,
      written for whoever sets up the server. Each section says what happens
      WITHOUT the integration, because three of the four will not be
      configured for a while
- [x] **A real linter, and it passes.** eslint 9 with type-aware
      typescript-eslint, its own tsconfig so it sees the spec files the build
      excludes, and `npm run lint` running both it and `tsc --noEmit`. Thirty-
      six errors on its first run, now ZERO — and not one inline
      `eslint-disable` was added to get there
- [x] It found real defects: seven values that would have printed as
      "[object Object]" (one on a receipt handed to a student, one in an
      exported CSV somebody reconciles months later), twelve async handlers
      whose rejection went nowhere, five pieces of dead code, and four literal
      byte-order marks in the code that strips byte-order marks
- [x] Two rules are declined with reasons written in the config, not
      suppressed: `require-await`, because it cannot tell an interface
      contract from a gratuitous async; and `no-unnecessary-type-assertion`,
      because `--fix` with it on stripped `as InputJsonValue` from four Prisma
      writes, broke the build and reddened five tests. The `unsafe` family
      stays at WARN — 259 of them, all at boundaries this System cannot type
      and every one validated immediately after
- [ ] No load testing against NFR-PRF targets
- [ ] Accessibility verified by construction, not yet audited with a screen reader
- [x] **Deployment**: a Dockerfile and a compose stack — PostgreSQL, the API,
      and nginx serving the built app on one origin — with an entrypoint that
      generates keys, migrates, and applies the constraints. **Built and run**:
      both images build, the stack comes up healthy, all 13 migrations apply,
      and sign-in works end to end through the proxy. Running it found the
      trust-proxy defect below, which reading it had not.
- [ ] No runbook beyond the README's deployment section

---

## How the work has actually gone

Worth recording, because it shapes what to expect from the remainder.

Thirty-five security or correctness defects have been found and fixed, and **the
permission matrix was correct in almost every one of them.** What went wrong each time was a resource
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

The sixteenth was different again, and worth recording because it inverts the
pattern. Step-up re-authentication never worked: it verified the password and
returned a timestamp with nowhere to go, so every resource marked
`requiresStepUp` — granting sub-permissions, impersonation, restoring a backup,
storing integration credentials — was unreachable by anybody, permanently. Not
a leak. A lockout.

**No earlier probe caught it, and the reason matters.** Every one of them
asserted that the privileged operation was REFUSED without step-up, and it
was. Nobody checked whether stepping up then let it through. Testing a refusal
without testing the corresponding grant leaves exactly this shape of hole, and
it stayed open through four features that each declared they needed it.

Three since: a fee reconcile route guarded by `payment:configure` when the
matrix grants payment FULL and FULL has no `configure` in it, so the route
answered 403 to everybody forever; an attendance report that flagged students
at a hardcoded 75% while the institute setting decided everywhere else; and a
timetable range whose date-only upper bound parsed as midnight, silently
dropping the final day's classes from every week a student asked for.

The first of those was the FOURTH of one shape — a guard nobody can satisfy —
so it now has a static guard of its own: every @RequirePermission in the
codebase must name a real resource, a real action, and a pair some role can
actually hold. It was verified by reverting the fix and watching it fail with
the route named, rather than trusted because it passed.

The thirty-fifth came from reading a slip back for the first time. `put(key)`
treats its argument as a PREFIX and appends its own generated name — that is
SEC-FIL-005, so an uploader never chooses where their file lands — and returns
the real ref. I stored the prefix, so every slip recorded a DIRECTORY as its
location and the first attempt to open one failed with EISDIR. Nothing had
ever read a slip back, so nothing had noticed. **A write nobody reads is not a
feature that works; it is a feature nobody has tested.**

The thirty-second, third and fourth were one discovery: **no member of the
public had ever been able to submit an application.** The submit schema
demands one to five payment slip ids; nothing in the System created a slip;
the column linking one to an application was NOT NULL, so an unattached slip
could not exist even in principle; and the code meant to attach them matched
documents already belonging to a request that had just been created, then set
`data: {}`. Three independent faults in one path, each of which alone would
have been enough. Nothing caught it because every test and probe had gone in
through the admin queue with data the seed had put there — **the front door
had never been opened from outside.**

The thirty-first shipped, and was mine. The receipt page was written, the API
worked, the fees screen linked to `/receipts/:id`, the build passed — and the
route was never added, so **every Receipt button led nowhere from the moment it
appeared**. TypeScript is content, because an unrouted page is a module nobody
imports; Vite is content for the same reason; the API tests never see the web
app. "The build passes" proved only that the file compiles. There is a guard
now, and writing it produced two more instances of the same failure: it used
`describe.skip` when it could not find the web app and reported five tests
passing by skipping them, and then it cried wolf over a page routed with props.
A guard that silently does nothing, and a guard that cries wolf, both end the
same way.

The thirtieth was the same pattern for the sixteenth time, and I made it
myself while writing the at-risk report: it was guarded by `report_progress`,
which a STUDENT holds at OWN scope so they can read their own progress. So a
student could run a report titled "Students at Risk" and be shown themselves
and what they owed. The scope predicate held and it was never a leak — it was
once again **a resource named after a topic guarding two different
audiences**. Sixteen instances now, and the reachability guard cannot catch
this one: the permission is real, the role genuinely holds it, and only asking
"who is this screen FOR" finds it.

**The lesson has been the same every time otherwise: nearly every defect was
found by running the code against a real database, not by reading it.** The 748
unit tests have never caught one. The twenty-five end-to-end probes caught all
of them.

A related habit, learned the hard way this week: **a probe that changes
settings must prove it put them back.** The programme-certificate probe lowered
the Institute's completion thresholds to exercise the grant path — a supported
thing to do — and then failed to restore them, because `/settings` returns
groups and the restore code flattened them as one list, found nothing, and
wrote `undefined`. The thresholds sat at zero, every student instantly
eligible for a certificate, until I read them back. It now clears the override
rather than writing the old number back, and asserts the restored state
instead of assuming it.

A newer habit, and a useful one: several probes have passed VACUOUSLY and been
rewritten. One asserted that no student sat between two attendance thresholds —
true, and proving nothing. Another took the published-lesson branch and never
exercised the draft one, which was the half that mattered. A green check that
could not have failed is worse than no check, because it is counted.

The twenty-fourth was arithmetic, and worth recording because of where it
lived. The import preview counted a returning student both as somebody to load
and as somebody to rejoin; the button is labelled with their sum, so a file of
one new student, one returning and one blocked offered to "Load 3 students"
and then reported two. It had no test because it sat in a service rather than
in a pure module — so the fix was to move it into one, where it now has seven
tests including the property that the three counts always add up to the rows
given. **A button that promises a number its own result contradicts is worse
than a button with no number on it**, and the probe now asserts the preview's
promise against the outcome so the two cannot drift apart in silence.

The twenty-ninth had been there from the beginning and is the plainest of the
lot: **every Export CSV button on the Reports page answered 401.** It was a
plain anchor to the export endpoint, and an anchor sends no Authorization
header — so nobody had ever exported a report from this System. It sat in a
file that had been read several times, because a link that looks right reads
as right. Only asking what the browser actually sends found it.

Two more were caught in work written the same afternoon, by tests written to
catch exactly that: five of ten resource names on the impersonation
forbidden-list were invented and matched nothing, and `own_session` was on that
list when ending an impersonation *is* an own_session delete — which would have
trapped the impersonator inside somebody else's identity until the token
expired. A forbidden-list entry that names nothing protects nothing while
looking like it does, so both that list and the erasure policy now have static
guards asserting every name is real.

The deployment configuration was the first piece of work that could not be run
here at all, and it is worth recording what that changed. Reading it against
the code it deploys still found four things, each of which would have cost data
or access: no volume for uploaded files, so a rebuild would have destroyed
every payment slip while leaving the rows pointing at them; a storage signing
secret falling back to a string published in this repository, which would let
anyone forge a download URL for any file; a health probe that was wrong in two
opposite directions at once, since the endpoint answers 200 while degraded and
can never report healthy; and a shell script that would have been checked out
with CRLF and failed inside the container with a message naming neither the
file nor the cause.

So checking a thing you cannot run is worth doing and is not the same as
running it. The four findings came from reading the deployed code — where the
storage root resolves to, what the secret signs, what the endpoint actually
returns — rather than from the configuration reading plausibly, which it did
before any of them were found.

Docker was then installed, and the second half of that sentence proved itself
immediately. Both images built first time and the stack came up healthy, so
the reading had been worth doing — but running it found a twentieth defect
that no amount of reading had. Behind nginx, Express reports the PROXY as the
client, and the throttler is a global guard keyed on the client address. The
whole Institute would have shared one 300-request-per-minute budget against
the 150 concurrent users of NFR-PRF; the admission form's three-per-hour would
have applied to every applicant collectively; and the security log's
account-probing detection, which groups failures by address, would have seen
one address for everybody. It is fixed with a hop count rather than a boolean,
because a client can forge X-Forwarded-For and a blanket trust would let an
attacker change their apparent address per request to evade the very limit
meant to stop them. Both directions were verified: a real sign-in now records
the real client, and a sign-in carrying a forged address records the real
client too.

That is the pattern holding at twenty: **the defect was in the seam between
two things that were each correct.** nginx forwarded the address properly and
the throttler keyed on the address properly; nothing had told Express to read
the header. Seams are only visible when both sides are actually running.

---

## 17 August 2026 — the admission emails

An applicant now hears from the System four times: the tracking reference when
they submit, the sign-in details when they are admitted, a request when
something is missing, and the reason when they are refused. Before today the
first two were shown on a screen and nowhere else, and the last two were not
told to the applicant at all — the state changed to NEEDS_INFO and both sides
waited for the other. `ADMISSION-EMAILS.md` is the checklist, and every line in
it was verified by running the flow over HTTP against the Docker stack, to a
real Gmail address, rather than by reading the code.

Both messages go straight through the mail adapter rather than the notification
service, for two reasons that are really the same reason: an applicant has no
account to write an inbox row against, and a temporary password must not be
stored in a row that outlives its usefulness by years. Both are sent after
their transaction commits and neither can fail it — an approval that rolled
back because Gmail was slow would be far worse than an email that did not
arrive — and the administrator is still shown the password on screen, now
beside a line saying whether it actually went.

**Three faults, and all three were in seams.** The pattern from the twentieth
defect held exactly.

The first: **email was never configured inside Docker**. `docker-compose.yml`
named no mail settings, and compose gives a container only what it names —
`.env` is read to interpolate the compose file, not injected into services. So
the credentials worked from the host, the check script passed, a test message
arrived, and the same code in the container had no mail server and correctly
suppressed everything. Each side was right; nothing joined them.

The second: **the first admission on a seeded database was refused**. The seed
writes eight students with their registration numbers spelled out and never
advanced the counter, so the first real approval was allocated a number already
in use and came back as `409 DUPLICATE_RESOURCE` on the System's most
consequential transaction, naming nothing an administrator could act on. This
is precisely the disagreement OPN-01 describes on the Institute's own data.
The allocator now checks that the number it was handed is free and steps over
any that are not, one atomic statement per attempt so concurrent approvals
still cannot collide. It walked past eight once, and will not walk again.

The third: **the application could not start, and 1,143 tests said it could.**
A service gained a constructor argument and the provider was never registered
in its module. Nest resolves that graph at run time, TypeScript cannot see it,
and every unit test builds its subject by hand with fakes — which is what makes
them fast and exactly why none of them could see this. There is now a test that
compiles the whole module graph, and it fails with the same message the
container did.

**A green check that could not have failed** appeared again, in my own work.
The check proving the password never reaches a log passed on its first run
because the mutation meant to break it was applied by a tool that does not
exist on this machine — the file was never modified at all. Re-run properly, it
fails on the leak. Every check written today was afterwards run against
deliberately broken code before being believed.

Twenty-three defects, and the number found by reading rather than running is
still zero.

---

## 20 August 2026 — the integrations, tested against the real thing

Four defects, and the pattern held for the fourth session running: **every one
was in a seam between two things that were each correct, and not one was
visible by reading either side.**

**Google Drive had been "blocked on DEP-01" for months and was not.** The key
was valid, the service account was right, and the Institute's folder was
already shared with it — twelve class folders, readable, with real recordings
in them. What was wrong was the name of a variable. The Drive provider, the
Meet provider and the integrations screen all asked for
`GOOGLE_SERVICE_ACCOUNT_JSON`, which **only `docker-compose.yml` sets** — it
composes it out of the `GOOGLE_CREDENTIALS_DIR` and `GOOGLE_SERVICE_ACCOUNT_FILE`
pair that a person actually writes in `.env`. Started any other way, which is
every `npm run dev` anybody has ever run, nothing composed it. So the status
screen said SIMULATED, `check-integrations.mjs` said "not configured", and
lectures fell back to local storage — each of them reporting honestly on the
question it had been asked, and all three asking the wrong question. Three
tools agreeing is why nobody suspected the answer. Resolution now lives in one
place and accepts all three forms.

**Fixing that immediately exposed a second defect the first had been hiding.**
The moment Drive worked, the integrations screen announced that Meet was live
too — because that entry also derived itself from "are there Google
credentials?". `google-meet.provider.ts` documents this exact trap at length:
Drive and Meet share a service account, so *the credentials arriving for one
integration silently arm another*. The provider had been fixed; the screen
describing the provider had not. It was claiming that meeting links were
created automatically while `LIVE_PROVIDER=manual` and every teacher was still
pasting links in by hand. It now asks the provider that will actually be used
whether it can create a meeting, which is the question a reader of that screen
is really asking.

**The temporary password reached its owner from one of the four places that
mint one.** Admission approval emailed it. Cohort import, staff account
creation and password reset each returned it to the administrator's screen and
stopped there — which is survivable for eight students in a room and is not
survivable for the hundred-row import that `FR-OPS-026` exists to serve. An
operator will not relay a hundred passwords by hand, so in practice the
passwords travelled by WhatsApp and stayed in the chat history, or they did not
travel and the accounts were never used. There is now one `CredentialsMailer`
that all four go through, and every screen that issues a password says whether
it also arrived. The cohort import marks the rows that did not, in the list and
in the downloaded file, because those are the only ones anybody has to chase.

**Every sign-in link the System has ever emailed pointed at `localhost`.**
`PUBLIC_WEB_URL` is set by `docker-compose.yml` and by nothing else, and the
approval read it with a `http://localhost:5173` default — an address that in an
email means *the student's own computer* and works for nobody. It now falls
back to `WEB_ORIGIN`, which every deployment sets because CORS does not
function without it, before falling back to localhost. The same omission had
emails signing off "The Institute" rather than "Prepreneurship".

**And one thing that was missing rather than broken.** `FR-REG-020` has had a
public endpoint since the beginning, the confirmation email has always told
applicants to keep their reference, and the landing page has always promised
"a tracking reference you can check at any time". Nothing in the web app could
check one. An applicant holding a reference had exactly one way to use it —
telephone the office — which is the cost that requirement exists to remove.
There is now a `/track` page, linked from the landing nav, the closing band,
the page shown after submitting, and the confirmation email itself. It is
routed *before* the authentication gate rather than only in the signed-out
branch, because an emailed link gets opened on whatever device is to hand and
falling through would answer a stranger's link with a student's dashboard.

**Nothing here was found by reading.** The Drive key was proved by exchanging a
real assertion for a real token and listing the Institute's own folders; the
mail path by sending real messages and watching the server accept them; the
tracking page by opening it in a browser at every state an application can
reach; and the honest-failure path by turning email off and confirming the
import says `NOBODY WAS EMAILED` rather than reporting success. Twenty-seven
defects, and the number found by reading rather than running is still zero.

---

## 20 August 2026 — courses, fees, and the student nobody wrote to

Three things the Institute could not do, and none of them was broken. All three
were **missing**, which is a harder fault to see: nothing errored, no test
failed, and every screen involved looked finished.

**A STUDENT WHO ENROLLED IN A SECOND COURSE WAS TOLD NOTHING AT ALL.** Both
places that can enrol somebody who is already a student — an admission approval
and a cohort import — deliberately sent them no email. The reasoning was
half right and had been written down: their account is not touched, there is no
temporary password, and mailing "here are your new details" to somebody whose
sign-in is unchanged is how a working account gets abandoned. All true, and the
conclusion drawn from it was still wrong. From where the applicant sits, they
filled in a form, paid a fee, attached a slip — and then heard nothing, while a
first-time applicant doing the identical thing got a welcome. Silence after
payment is indistinguishable from a lost application. They now get the news
without the password, and are told in as many words that there is no new one
and none is coming, because the likeliest thing they would otherwise do is wait
for it and then telephone the office to ask where it is.

**THE APPLICATION FORM ASKED FOR "THE AMOUNT YOU PAID" AND COULD NOT SAY WHAT
THAT WAS.** Fees existed only as `FeeCharge` rows raised against students who
were *already enrolled*, so the number was known to the office and to nobody
else. The form told applicants to "pay the fee into the Institute's account"
and named neither the fee nor the account. In practice they telephoned to ask,
or they guessed — and `AMOUNT_INSUFFICIENT`, a rejection reason the admission
module has carried since the beginning, is what a guess looks like from the
other end. There is now a `FeeStructure` per programme: a total, a breakdown, an
instalment schedule, and the amount due on application, published as a whole or
not at all. The apply page shows the figure at the moment the course is chosen
rather than four steps later, and the full table with the bank details on the
step where the money actually moves.

**AND THE ENDPOINTS TO CREATE A COURSE HAD NEVER BEEN REACHABLE.** `POST
/programmes` and `POST /subjects` have been there, correctly guarded, since the
beginning, and nothing in the running System could call either — the same fault
StructurePage was built to fix, one level up. Every programme that has ever
existed is one the seed script wrote. `Subject.thumbnailUrl` has been in the
schema just as long with **nothing anywhere ever writing to it**, so every card
on the landing page fell back to generated artwork and the Institute had no way
to change that. There is now one page for all of it, and one page deliberately:
creating a course, giving it a picture and setting its price are one job done in
one sitting, and split across three screens the third is the one that gets
forgotten — leaving a course on sale with no fee.

**THE ARITHMETIC IS THE PART THAT IS ACTUALLY DANGEROUS.** These numbers are
read by members of the public who then transfer money against them. A fee table
that does not add up is not cosmetic: the applicant pays what the instalments
said, the office checks the slip against the total, and the difference becomes a
rejection of somebody who did exactly what they were asked. So it is checked in
paisa as integers, on publication rather than on save — a half-typed table is
unfinished, not wrong — and every problem is reported at once, because an
administrator gets three things wrong at a time and one-per-save is three round
trips. The two numbers that must agree are enforced: the first instalment and
the amount the form will ask for. Left free to differ, the table says 25,000,
the form asks 30,000, and whichever the applicant believes makes their slip
wrong.

**FIXING ONE THING EXPOSED A SECOND, AGAIN.** Adding fee status to the
programmes list made it obvious that nothing on the courses screen said which
courses had a published price — the exact failure the page exists to prevent,
invisible on the page built to prevent it. It is now a badge on every card.

**And two guards in this codebase earned their keep.** The scope-coverage test
failed the moment the three new models existed, because an unclassified model is
readable by anyone who passes the role check and a missing entry looks exactly
like a model nobody has needed yet. The web-routes test failed because a new
page was not documented. Neither fault would have been visible by reading.

Twenty-seven defects and three absences. The number found by reading rather than
running is still zero.

---

## 20 August 2026 — lecture folders, uploads, and a dashboard you can act on

**THE DASHBOARD WAS A DEAD END.** It is the first screen everybody sees and its
whole job is to say what needs doing — "2 waiting for review", "3 registers not
marked" — and every one of those was a number and nothing else. The answer to
"what do I do about it" was: read it, remember it, find the right entry in the
sidebar, and start again from a list that does not know why you came. A figure
that names an action and cannot reach it is a worse affordance than no figure,
because it looks finished. Every counter, every exception and four of the card
headings are now links, role-gated in one table so a student is never offered a
destination that would answer 403. "Waiting over 48 hours" opens the queue
**already filtered to those**, because arriving at the unfiltered list and
finding them again by eye is the work the figure existed to save.

**THE FOLDER IDS WERE IN THE SYSTEM ALL ALONG AND IT NEVER SHOWED ANYBODY.**
Connecting a class to its recordings meant opening Drive in another tab, finding
the right folder among a dozen named things like "(Sec D) English Class" and
"(Sec I) English Class", copying the address bar and pasting it back. The
adapter could list that folder the entire time. There is now an index — name,
id, Drive link, copy buttons, and **which class already uses each folder**,
because twelve near-identical names with no indication of what is spoken for is
how two cohorts end up reading one folder and each seeing the other's classes.

It is behind a NEW resource, `lecture_storage_index`, held only by Super Admin
and Admin. A teacher holds `recorded_lecture:create` at ASSIGNED scope so they
can catalogue a recording for their own class, and it does not follow that they
should be handed the identifier of every other class's folder — a folder id is
close to a bearer token for that folder's contents. Reusing the existing
resource would have been one line and would have given every teacher the lot.

**A RECORDING FROM A LAPTOP COULD NOT BE ADDED AT ALL**, and the reason it is
now possible comes with a constraint that had to be measured rather than
assumed:

> A Google service account HAS NO DRIVE STORAGE QUOTA. It lists the Institute's
> folder, reads every file in it, and Drive answers `canAddChildren: true` — and
> refuses every upload with `storageQuotaExceeded`, because a file in an
> ordinary My Drive must be charged to somebody and a service account is nobody.

Probed before a line of the feature was written, which is the only reason the
design is honest: the panel asks whether the upload would be accepted **before**
offering a file picker, names both ways out — a Shared Drive, or domain-wide
delegation — and offers to store the recording in the System instead. A person
never waits for 300 MB to cross their connection to be told it was never going
to work.

**A DELIBERATE SAFETY INVARIANT WAS NARROWED, and that is worth stating
plainly.** `drive-readonly.spec.ts` pinned "the System never writes to the
Institute's Drive", with a read-only OAuth scope as a second barrier so that
even a mistake in the adapter would be refused by Google. Uploading required
changing that. What replaced it is narrower rather than absent: the adapter may
CREATE a new file through `putStream` and through nothing else; it may never
delete, trash, move, rename or overwrite; the writable scope is minted only for
an actual upload, so a deployment that never uploads never asks Google for a
writable token at all. The suite now fails if any of those three stops holding.

**Three defects found by running it, none visible by reading.**

The first: a failed catalogue left the bytes orphaned. The very first real
upload failed at the database write **after** the file had been streamed to
storage, leaving 3 MB that nothing referenced and nothing would collect.
Repeated by anybody retrying a failing upload, that fills a disk with files no
screen can see. A failure after the write now removes what was written — except
on Drive, where `delete()` still makes no request, because an orphan there is a
file somebody can see and remove and that is a far better failure than this code
deleting from the Institute's only copy of its recordings.

The second: **an SVG with a viewBox and no size fills its container**, and the
`Icon` component set neither. Every existing use happened to size it in CSS, so
the omission was invisible for the life of the project — until a new one did
not, and rendered a folder glyph eight hundred pixels tall down a list of twelve
rows. There is no global `.btn svg` rule either, so the same mistake was waiting
in every button an icon is ever put inside. The component now carries `1em` as a
presentation attribute, which loses to every CSS rule that already exists and
only applies where nothing has an opinion.

The third is the largest, and it had been there from the beginning: **a page
reload always signed the user out.** The access token lives in memory only — by
design, so it dies with the tab — so the first request after any reload carries
no Authorization header, and the server answers `AUTH_TOKEN_INVALID` because
there was no token to expire. The client's refresh branch required
`AUTH_TOKEN_EXPIRED`, so it never fired; `AuthContext` caught the error and ran
`clear()`, **destroying the stored refresh token**. The rotation, the 30-day
lifetime, the session that is supposed to survive a reload — none of it had ever
worked once. It looked exactly like a session timing out, which is why nobody
questioned it. The condition that matters is not which 401 it is; it is whether
there is a refresh token to try.

**And one thing found that is not fixed, because fixing it destroys data.** The
local development database was created with **WIN1252** encoding, and a WIN1252
database cannot store Urdu at all — `عائشہ` is refused by Postgres before the
application sees it. Latin-1 accents survive, so "Zoë" stores fine, which is
precisely what makes it dangerous: every test anybody is likely to type passes,
and the failure waits for a student whose name is written in the script most of
this Institute's students actually use. `db-local.mjs` now forces
`--encoding=UTF8` for any database it creates from now on, and warns loudly when
it starts an existing cluster that is not UTF-8. An existing one cannot be
converted in place — encoding is fixed at creation — so that call belongs to
whoever owns the data.

Thirty defects and three absences. The number found by reading rather than
running is still zero.
