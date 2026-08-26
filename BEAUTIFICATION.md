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

## The brand pass

Brand Guidelines V2.0, April 2026, Office of the CEO. The palette, the
typefaces, the logo and the breakpoints are now the brand's rather than this
codebase's own inventions.

`npm run brand:audit` checks every rule that can be checked mechanically and
prints what cannot be. It measures forty-odd contrast pairs while it is there.

| | |
|---|---|
| **Navy replaces indigo** | The product was built on #4338ca. §3.2 forbids "bright generic blues, purples, teals, or rainbow gradients" and §10.02 settles it: amber #f5a623 is the accent, navy #1a3c5e is the brand. Every token moved; not one page had to be edited, because the token NAMES did not change |
| **Twelve page hues deleted** | Violet, fuchsia, cyan, teal, pink, orange-red and a retired gold, one per screen. Every one of them was on the prohibited list. One amber rule under every heading now, which is §3.2's own "accent bars" |
| **Sora and Inter, self-hosted** | §4.1 names them. The previous pass had removed Inter and argued for the system stack — every objection in that argument was about Google's servers rather than the typefaces, and 101 KB of latin-subset variable woff2 from our own origin answers all of them |
| **The real logo** | The mark was a "P" drawn in CSS on a gradient, in six places. §2.3: "Recreate the logo from scratch — always use the master asset." The emblem is now cut from ppship-logo.png, with the wordmark dropped out at nav and favicon sizes as §2.4 requires |
| **"Dream. Learn. Earn."** | §1.2, exact punctuation, on every page without exception. It is in the sidebar lockup, which is the one piece of furniture that qualifies |
| **Amber is the call to action** | §7.4 — amber ground, navy text, 5.6:1. It was white on indigo, which made the primary button the same colour as the furniture around it |
| **Solid navigation** | §10.11: "No transparent state." Both the app top bar and the public site's nav were a translucent wash over a blur |
| **Brand breakpoints** | §7.2 — burger at 1100px, mobile 768, small 640. The app had picked 900, 880 and 860 by eye |
| **Body type** | 16px on 1.6, from 15px on 1.55. §4.2 puts body at 16–18 and §4.3 makes 1.6 a floor |

### Three places the brand book was followed with a stated deviation

Each is a case where two rules in the book cannot both hold, so one had to
give. All three are commented at the point of change.

- **The caption grey.** §7.1 gives `--ink-soft` as `#6b7280` and §3.1 gives the
  cream ground as `#f0f4f8`. Together they measure **4.37:1**, and §6.3 itself
  demands 4.5:1. Darkened four per cent to `#616b7b` — 4.88:1 on cream, 5.39:1
  on white.
- **The heading scale.** §4.2 puts H1 at 56–72px. That is written for
  prepreneurship.com, where the H1 is the only thing on screen; here it is the
  title of a register with forty rows under it. Application screens use the H3
  Subhead band (22–32px), which is still the brand's scale. The public hero
  keeps the brand's hero size.
- **The sign-in lockup.** §2.3 wants the full lockup on institutional surfaces
  and §2.2 wants "the reversed light version" on deep navy. The master file's
  wordmark is Wordmark Black and no reversed asset exists, so the emblem is
  paired with the wordmark set in Sora rather than placing a black-wordmark
  file on navy.

### What the brand pass did NOT do

- **Photography (§6.2).** There are no Institute photographs in this repo, so
  nothing was checked and nothing is claimed.
- **Voice and tone (§5).** Copy was not rewritten. The book asks for
  conviction over excitement and forbids "training centre", "course" and
  "workshop" among others; that is a screen-by-screen copy review and it has
  not happened.
- **The Flutter app.** `apps/mobile_app` is untouched and is still on the old
  palette.

## The shell

The frame rather than any screen, done once so all four roles inherit it.

| | |
|---|---|
| **Skip to the content** | The first focusable element on the page. The sidebar renders before `<main>` and holds up to twenty-four links, so a keyboard user was tabbing through the whole navigation on every screen before reaching anything (WCAG 2.4.1). None of the static checks could have found it — they read markup, and this is about order |
| **One list of destinations** | `navigation.ts`. The sidebar renders it and the command palette searches it, so there is no second hand-written copy of the role predicates to drift. The predicates themselves are unchanged |
| **A rail** | The sidebar narrows to 64px and remembers the choice. Labels are clipped, never `display: none`, so every link keeps its accessible name. Between 901 and 1180px the rail is the default, because a laptop has nothing to spare |
| **Go to a screen** | Cmd-K or Ctrl-K. It searches SCREENS, not students or classes, and says so in the placeholder and again in the empty state — there is no global search endpoint, and a palette that looked as though it searched people would report "no such student" when it had never looked |
| **An account menu** | Name, role, a student's registration number, change password, appearance, sign out — in the top strip. Signing out used to mean opening the drawer on a phone and scrolling past every destination to an unlabelled button |
| **Light, dark, or the machine** | The dark palette has existed since the first pass and was reachable only by changing your operating system. Three states, defaulting to the system, applied before React mounts so a dark reader does not get a white flash on every load |
| **Sections and Structure are staff-only** | They are institute-configuration screens and they were two of a student's eight destinations. The ROUTES are unchanged and still resolve for anybody who types the address; this is the interface declining to offer something, which is all it was ever able to do |

## Two claims below that this document made too early

Written down rather than quietly corrected, because the pattern is the point:
a document that describes intent in the past tense is how work gets counted
twice.

- **"Twenty-four screens said Loading… in grey"** — the `Skeleton` component
  was built and is correct. It reached three pages. There are still 33 bare
  `Loading…` strings across roughly thirty screens.
- **"UsersPage — zebra striping and a sticky header"** — the table primitives
  exist and are good. People renders a `<ul>`, so there is nothing to stripe.
  The same is true of Audit, Admissions, Bulk changes and Certificates.

Both are scheduled: the tables with the Admin pass, the loading and empty
states as a sweep across all pages after the role work.

---

## The pages

### The public front

| Page | What it got |
|---|---|
| **LandingPage** | Cover art on every course card, with the artwork lifting on hover. Photographs became a cross-fading stage with a slow drift, arrows and dots. News rotates one notice at a time on a nine-second dwell with named tabs and a progress bar. A counted stat band, a closing band in full brand colour, one entrance on the hero |
| **VerifyPage** | Given an address of its own. `/verify` with no code was unreachable — every route was `/verify/<code>`, which serves the one person who scanned a QR and nobody else, and the lookup form sat under a heading reading "check **another** certificate" that only appeared after a first one succeeded. Now the front door for an employer holding printed paper: an intro above the box, and a heading that says "another" only once there has been one |
| **ApplyPage** | Stepper with completed steps ticked, per-field validation colour, the education level as a proper list |
| **LoginPage** | Split panel — the brand on one side, the form on the other. Collapses on a phone so the form stays above the fold |
| **ForgotPasswordPage** | The same card, centred, with no brand column — one short errand, not a welcome. Two steps: the address, then a confirmation saying what will happen |
| **ResetPasswordPage** | The same card again. The password twice, because there is no current one to fall back on if a typo goes through |
| **VerifyPage** | Certificate verification, styled as a **result rather than a form**: the verdict is a sentence in the first line, with a coloured rim and a mark supporting it rather than carrying it. Three outcomes, not two — verified, revoked, and archived, which is genuine but withdrawn and must never be reported as revoked. A number box underneath for somebody holding a photocopy and no camera |
| **TrackPage** | Application tracking, and a page that did not exist at all — the landing page promised "a tracking reference you can check at any time" and there was nowhere to check it. One field and one button on a single line, the reference set in the same monospace face the confirmation page uses so the two read as the same object. The answer is a plain-language verdict with a coloured pill, not a status enum; the office's own message is set apart as a quotation, which for NEEDS\_INFO is the entire point of the page |

### The daily screens

| Page | What it got |
|---|---|
| **CourseAdminPage** | A page that did not exist. `POST /programmes` and `POST /subjects` had always been there and nothing in the running app could call either, so the only courses that ever existed were the four the seed wrote. Cards carry the course's own picture — `Subject.thumbnailUrl` had been in the schema since the beginning with nothing ever writing to it — and the upload previews at the size it will actually appear, rather than reporting "uploaded" and showing nothing. The fee editor keeps a running total under each block, in a word and a colour, because the rule that decides whether it can be published is "the lines add up" and learning that on publish means re-adding twelve numbers by hand |
| **SubjectEditPage** | A subject used to be four fields in a panel wedged inside a card. It is a page now, with the two things the schema had always carried and no form ever asked for: `isActive`, so a subject that is no longer taught can be retired instead of deleted or left to clutter every picker, and `thumbnailUrl`, previewed at the size the tile will draw it. "Where it is taught" lists the courses that already teach it, so nobody renames a subject without seeing what they are renaming |
| **CourseEditPage** | The course and its syllabus, which had been two separate panels behind two separate buttons, on one page in the order the work happens: name it, choose what it teaches, give it a picture, see its batches and its fee. A course with no subjects and no batches now says so in a banner that names the missing pieces, because "created successfully" followed by a course nothing can be enrolled in is the least useful true sentence in the product |
| **BatchEditPage** | Five numbered steps for the thing that had the worst gap in the system: **twenty of twenty-four subject-batches had no teacher**, because `POST /teacher-assignments` existed and no screen in the app called it. The teacher step lists every teacher with the load they already carry, so the choice is made against the roster rather than from memory. WhatsApp channel and group links, shown to students since FR-REG-044 and unsettable since FR-REG-044, are step five. The subject list starts as the course's own syllabus, since a batch that teaches something else is the exception |
| **CompletionPage** | A page that did not exist, for the decision the System was making on nobody's behalf: completion was computed from thresholds and a certificate followed. Three states side by side as a radio group — still going, completed, did not complete — with the consequence of each written on the control, because a tickbox has no way to say "finished, and did not pass". The figures sit beside every row as evidence, and the reason box appears the MOMENT a choice disagrees with them rather than after a refused save. Overrides are recorded with the arithmetic as it stood, so a certificate issued against a 61% attendance has an answer six months later |
| **GradingPage** | **Marking one submission at a time**, the arrangement every serious marking tool has converged on. The list was the only view, so marking thirty pieces of work meant thirty rounds of find-the-row, expand, mark, collapse — losing your place each time the list re-sorted and the row you just marked jumped out of the unmarked block. The list stays as the overview; a focused view holds the work, the mark box and the feedback on one screen with a sticky bar carrying the position, the number still to mark, and Next. Saving advances to the next thing still needing doing rather than the next row. Arrow keys move, Escape returns — bound only when a text box does not have focus, or a shortcut eats a half-typed sentence |
| **Guidance on 24 screens** | Attendance, marking guides, quiz marking, content, courses, admissions, people, certificates, import, bulk changes, courses & fees, sections, structure, reports, settings, integrations, messages, audit, security, backups, announcements and fees — each with four steps, an intro and the one thing people get wrong. Written for somebody non-technical: no `session`, no `provider`, no `rubric`. Every panel checked in a real browser under a role that can actually reach the screen, because a panel inserted into an unreachable branch renders for nobody |
| **HowItWorks (the mechanism)** | Orientation drawn as the sequence a task actually is: numbered steps with connectors, a row on a wide screen and a column on a narrow one. Markup rather than a picture, so it reflows, reads aloud in order, and cannot go stale the way an SVG of a renamed button does. Dismissible per screen and remembered, because guidance that cannot be shut up is guidance people learn to scroll past |
| **DashboardPage** | Cards stagger in; list rows became label-and-value with lining figures and a hover ground; figures tinted with the page colour |
| **TimetablePage** | **Month and week beside the agenda**, which stays the default because it is the only one usable on a phone and it answers "what is next" better than a grid. The month answers the question a list cannot — how does this period LOOK, three assessments landing in one week — with six rows always, so paging through the year never makes the page jump. Colour by subject, derived from its name so it is the same colour every load, in six bands so two subjects are clearly the same or clearly different rather than almost. Overflow is COUNTED (+2 more), because a cell that truncates silently lies about a day. Arrow keys page, T returns to today |
| **TimetablePage (original)** | Ruled-paper texture, page blue |
| **AttendancePage** | **A real defect fixed** — present, absent, late and excused were all the same indigo. Now green, red, amber and slate, with the letter drawn in each cell |
| **MySubjectsPage** | Course cover chip beside each subject, so a course is the same artwork here as on the landing page. Progress ring kept as the focal point |
| **SubjectPage** | Inherits the card, list and figure treatment |
| **ClassPage** | One scheduled class, with the join button that used to do nothing. A dark stage the size a player would be, a live pulse beside the word "live" so colour is never the only signal, and a countdown that ticks in seconds under a minute because "starts in 0 minutes" reads as a fault. The video itself cannot sit here — Google answers `X-Frame-Options: SAMEORIGIN` for Meet — so the page owns everything around it and says so plainly before the student presses anything |
| **CoursesPage** | The way in, which did not exist — the course page was reachable only by knowing a UUID or drilling three levels into Sections. Course cover art per tile, and the two facts visible nowhere else shown as **buttons that filter**, not text: recordings waiting to be published, and classes with no Drive folder connected. A zero is not coloured amber — it is good news, and colouring it would teach people to ignore the colour |
| **CoursePage** | One class's recordings as cards: thumbnail drawn from the lecture's own title, duration badge bottom-right where every video service puts it, a red progress line under anything started, and a state as a word. Cards are **links now, not buttons** — watching has its own address. Drafts on a separate shelf rather than mixed in with a badge |
| **WatchPage** | The shape everybody already knows: video large on the left against black, the rest of the class stacked down the right with the current row marked, "next in this class" above the queue where a phone reader actually meets it. **No autoplay** — a recording that starts talking on its own in a shared room is the most complained-about behaviour on the web — and no recommendations from other classes |
| **AnnouncementsPage** | Pink page colour, calm diagonal texture |
| **DiscussionPage** | The threading and the chat feel were already right. What was missing is everything that decides whether a course forum is USED: **posting without the class seeing who** — the failure mode is silence, not disorder, and students stay away because they fear looking ignorant in front of people they sit beside — plus a teacher-endorsed answer marked wherever the reply appears, and a way to say a question is settled so "which has nobody dealt with" is answerable. Anonymity is to CLASSMATES only; staff always see, and see that it was asked for. Enforced in the single `present()` projection, with the author id withheld alongside the name, because an id is an identity too |

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
| **FeesSubmissions** | The four figures as bordered tiles, not filled cards. "Awaiting checking" is dashed rather than tinted: it is the one figure on the screen that is evidence and not money, and a green tile is how a student comes to believe a screenshot settled their fee |
| **PaymentSubmitPage** | Currency set inside the amount control, large numeric entry, a drag-and-drop target sized for a one-handed tap. Most of these arrive from the phone the screenshot is already on |
| **PaymentVerificationPage** | Queue treatment: KPI band, filter grid, and a review panel whose decision buttons stay pinned while the reviewer scrolls the proof |
| **ReceiptPage** | **All decoration removed for print.** The page wash was fixed to the viewport and would have repeated on every sheet. Rebuilt as a document rather than a card: letterhead rule, fixed field rows, the figure larger than anything else, a four-line account, a signature block and a verification QR |

### Admissions and people

| Page | What it got |
|---|---|
| **AdmissionsPage** | Orange page colour, diagonal weave |
| **CohortImportPage** | As above |
| **UsersPage** | Slate page colour; zebra striping and a sticky header that stays above scrolled rows |
| **BulkPage** | As above |
| **SectionsPage** | Teal page colour; inline create form beneath the table, expanding subject panel |
| **StructurePage** | As above |
| **CertificatesPage** | Gold — **darkened from #ca8a04 to #a16207**, which failed contrast at 2.94:1. Now three tabs rather than one long screen, because the register, issuing what was earned and issuing by hand are three different jobs done at three different moments. A five-figure band at the head, a debounced search over name and certificate number, and a register table whose Open action shows the real document rather than a row of fields |
| **MyCertificatesPage** | A student's shelf. Tiles carrying the **actual certificate**, scaled from the same SVG the download rasterises, so a tile can never show something the file does not — and an empty state that explains how one is earned rather than saying there are none |

### Reports and operations

| Page | What it got |
|---|---|
| **ReportsPage** | Cyan, ledger grid. Result cells decide for themselves: numbers right-aligned in lining figures, sentences allowed to wrap |
| **AuditPage** | Red page colour, dense grid texture |
| **SecurityPage** | As above; timestamps given fixed width so the column stops resizing as events arrive |
| **BackupPage** | As above |
| **SettingsPage** | **A filter across 32 settings**, matching key, description and group — findability was the real problem on this page. Deliberately no texture: a form reads better on a plain ground |
| **PublicPageEditorPage** | The screen that edits another screen, and the only one whose result strangers see. Eight numbered cards in the order a visitor meets the page — first screen, claims, videos, photographs, notices, programmes, closing band, footer — with the preview a real frame of the real page beside the form on a laptop and underneath it on anything narrower. **The lists are rows, not a comma-separated box**, which is the whole reason this exists rather than a filter on Settings: a URL retyped into a shared text field is a URL somebody eventually breaks, and the settings editor lowercased them, which silently killed every YouTube link. Photographs upload and appear at the size they will be, captions beside them because a caption is the alt text. Each field carries its own description, its character count in a word as well as a colour, and its way back to the default |
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
