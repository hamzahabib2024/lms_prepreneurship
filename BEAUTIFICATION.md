# The look of every screen

All 36 pages, and what each one got. Written so nothing can be quietly skipped:
the list is generated from `apps/web/src/pages`, so a page added later that
never appears here is a page nobody styled.

## How this was done, and why not one page at a time

Every screen shares one vocabulary — `page-head` appears in all 36, and there
are 112 cards between them. Thirty-six separate stylesheets would look right on
the day and drift apart within a month, so the work went into the shared system
with a hook per page, and the genuinely per-page work was done individually.

Four things reach every screen without any page being edited:

| | |
|---|---|
| **A colour per page** | Set from the address, matching the sidebar icon you clicked. It lands on a rule under the heading, a hairline on cards and a dot before card titles — never on body text |
| **A texture per page** | Ruled paper for registers, a ledger grid for money, dots for teaching, a diagonal weave for admissions, a dense grid for the guarded screens. A few per cent, so it registers as "this screen feels different" rather than as decoration |
| **Motion** | Cards stagger in, buttons press, rows light up, alerts arrive rather than appear. Nothing over 300ms, nothing that bounces, all of it off under `prefers-reduced-motion` |
| **Depth** | Cards lift on hover — but only the ones that are actually clickable |

## Verified, not eyeballed

- **24 colour/theme combinations** measured for contrast. Two failures found and
  fixed: the certificate gold at 2.94:1, and eight of twelve page colours in
  dark mode, worst 2.36:1.
- **12 cover-art hues** measured. Ten failed at first — the greens and yellows
  at 1.8:1, while blue and violet passed, which is exactly how that fault
  survives being looked at. All twelve now clear 4.5:1, worst 5.04.
- **The print surfaces**: every decoration is switched off for paper. A receipt
  is a document somebody is handed.
- **The class-coverage guard** runs on every change: a class a page uses but the
  stylesheet does not define fails the build.

---

## The pages

### The public front

| Page | What it got |
|---|---|
| **LandingPage** | Cover art on every course card, with the artwork lifting on hover. Photographs became a cross-fading stage with a slow drift, arrows and dots. News rotates one notice at a time on a nine-second dwell with named tabs and a progress bar. A counted stat band, a closing band in full brand colour, one entrance on the hero |
| **ApplyPage** | Stepper with completed steps ticked, per-field validation colour, the education level as a proper list |
| **LoginPage** | Split panel — the brand on one side, the form on the other. Collapses on a phone so the form stays above the fold |
| **VerifyPage** | Certificate verification, styled as a result rather than a form |

### The daily screens

| Page | What it got |
|---|---|
| **DashboardPage** | Cards stagger in; list rows became label-and-value with lining figures and a hover ground; figures tinted with the page colour |
| **TimetablePage** | Ruled-paper texture, page blue |
| **AttendancePage** | **A real defect fixed** — present, absent, late and excused were all the same indigo. Now green, red, amber and slate, with the letter drawn in each cell |
| **MySubjectsPage** | Course cover chip beside each subject, so a course is the same artwork here as on the landing page. Progress ring kept as the focal point |
| **SubjectPage** | Inherits the card, list and figure treatment |
| **CoursePage** | One class's recordings as cards: drawn thumbnail in the page's own colour, play ring that grows on hover, duration, date, and a state as a word. Drafts on a separate shelf rather than mixed in with a badge — a teacher scanning for "what have I not published" should not have to read every card |
| **AnnouncementsPage** | Pink page colour, calm diagonal texture |
| **DiscussionPage** | As above |

### Teaching

| Page | What it got |
|---|---|
| **MarkingPage** | Magenta page colour, dotted texture |
| **GradingPage** | Staff notes panel set apart from the feedback box, because one goes to the student and one never does |
| **QuizBuilderPage** | Card and form treatment |
| **QuizMarkingPage** | As above |
| **RubricsPage** | As above |
| **AssignmentBuilderPage** | As above |
| **ContentPage** | Violet page colour, dotted texture |

### Money

| Page | What it got |
|---|---|
| **FeesPage** | Green page colour, ledger-grid texture, tables with lining figures |
| **FeesPanels** | Shares the fees treatment |
| **ReceiptPage** | **All decoration removed for print.** The page wash was fixed to the viewport and would have repeated on every sheet |

### Admissions and people

| Page | What it got |
|---|---|
| **AdmissionsPage** | Orange page colour, diagonal weave |
| **CohortImportPage** | As above |
| **UsersPage** | Slate page colour; zebra striping and a sticky header that stays above scrolled rows |
| **BulkPage** | As above |
| **SectionsPage** | Teal page colour; inline create form beneath the table, expanding subject panel |
| **StructurePage** | As above |
| **CertificatesPage** | Gold — **darkened from #ca8a04 to #a16207**, which failed contrast at 2.94:1 |

### Reports and operations

| Page | What it got |
|---|---|
| **ReportsPage** | Cyan, ledger grid. Result cells decide for themselves: numbers right-aligned in lining figures, sentences allowed to wrap |
| **AuditPage** | Red page colour, dense grid texture |
| **SecurityPage** | As above; timestamps given fixed width so the column stops resizing as events arrive |
| **BackupPage** | As above |
| **SettingsPage** | **A filter across 32 settings**, matching key, description and group — findability was the real problem on this page. Deliberately no texture: a form reads better on a plain ground |
| **IntegrationsPage** | Indigo; simulated services marked so nobody mistakes one for a send |
| **TemplatesPage** | Message wording with a live preview |
| **ChangePasswordPage** | Card and form treatment |

---

## What is deliberately plain

**SettingsPage and the other configuration screens have no texture.** A settings
screen is a long form, and a form is easier to read on a plain ground. Adding a
pattern to every screen because a checklist has a row for it is how a house
style becomes wallpaper.

**No page has a photograph as its background.** Photographs are on the public
page, where they are the Institute's own and the point is to show the place.
Behind a register or a fee ledger they cost bandwidth, hurt contrast, and are
the first thing to look dated.

## What still needs a person

**The screen-reader audit.** Contrast is measured and the mechanical checks
pass, but whether a screen makes sense read aloud — reading order, whether a
live region fires at the right moment, whether a control has a usable name —
needs somebody with a screen reader. It has not happened.
