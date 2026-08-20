# -*- coding: utf-8 -*-
"""
Generates UI-CHECKLIST.md — every page, what changed, and what has not.

GENERATED, NEVER HAND-WRITTEN, and the reason is written into the history of
this repository: BEAUTIFICATION.md claimed skeleton loading states and striped
admin tables that had been designed and never landed. It was true on the day
it was written and quietly false a month later.

The STATUS columns below are read from the pages on every run. The "what
changed" note is curated — a machine cannot say why something was done — but a
note attached to a page whose flags say the work is absent is reported as a
discrepancy rather than printed as though it were true.

    python scripts/ui-checklist.py            # write UI-CHECKLIST.md
    python scripts/ui-checklist.py --check    # fail if it is out of date
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, "apps", "web", "src", "pages")
OUT = os.path.join(ROOT, "UI-CHECKLIST.md")

# Who is offered the screen, from the route guards in App.tsx and the sidebar
# predicates in navigation.ts. "public" means reachable signed out.
ROLES = {
    "AdmissionsPage": "Admin, Super Admin",
    "AnnouncementsPage": "everyone",
    "ApplyPage": "public",
    "AssignmentBuilderPage": "Teacher, Admin, Super Admin",
    "AttendancePage": "Teacher, Admin, Super Admin",
    "AuditPage": "Admin, Super Admin",
    "BackupPage": "Super Admin",
    "BulkPage": "Admin, Super Admin",
    "CertificatesPage": "Admin, Super Admin",
    "ChangePasswordPage": "everyone",
    "ClassPage": "everyone",
    "CohortImportPage": "Admin, Super Admin",
    "ContentPage": "Teacher, Admin, Super Admin",
    "CoursePage": "everyone",
    "CoursesPage": "everyone",
    "DashboardPage": "everyone",
    "DiscussionPage": "Student, Teacher",
    "FeesPage": "Student, Admin, Super Admin",
    "FeesPanels": "Admin, Super Admin",
    "GradingPage": "Teacher, Admin, Super Admin",
    "IntegrationsPage": "Teacher, Admin, Super Admin",
    "LandingPage": "public",
    "LoginPage": "public",
    "MarkingPage": "Teacher, Admin, Super Admin",
    "MySubjectsPage": "Student",
    "QuizBuilderPage": "Teacher, Admin, Super Admin",
    "QuizMarkingPage": "Teacher, Admin, Super Admin",
    "ReceiptPage": "Student, Admin, Super Admin",
    "ReportsPage": "Teacher, Admin, Super Admin",
    "RubricsPage": "Teacher, Admin, Super Admin",
    "SectionsPage": "Teacher, Admin, Super Admin",
    "SecurityPage": "Super Admin",
    "SettingsPage": "Admin, Super Admin",
    "StructurePage": "Teacher, Admin, Super Admin",
    "SubjectPage": "Student",
    "TemplatesPage": "Admin, Super Admin",
    "TimetablePage": "everyone",
    "TrackPage": "public",
    "UsersPage": "Admin, Super Admin",
    "VerifyPage": "public",
    "WatchPage": "everyone",
}

# What was done to this screen beyond the palette, which reached all of them.
NOTES = {
    "AdmissionsPage": "Queue skeleton shaped like the applicant list. Amber accent replaces the orange-red page hue.",
    "AnnouncementsPage": "Real empty state — says notices appear here and no action is needed, instead of a grey sentence. Panel skeleton.",
    "ApplyPage": "Emblem replaces the drawn “P” in the header. Stepper and field validation repainted navy/amber. Panel skeleton.",
    "AssignmentBuilderPage": "Palette and type only — the screen is a form and was already correctly shaped.",
    "AttendancePage": "Two table skeletons at the register's real column count. Present/absent/late/excused keep their four distinct colours; only the page accent moved to amber.",
    "AuditPage": "Table skeleton, and an empty state that says the log is not empty — the filters exclude it — rather than “Nothing matches that.”",
    "BackupPage": "List skeleton. Red page hue replaced by the single amber accent.",
    "BulkPage": "Empty state explains that the section has no students and points at Admissions, with the alternative of choosing another section.",
    "CertificatesPage": "It rendered nothing at all while loading — no placeholder, no word — so a slow request looked like a subject with no students. List skeleton added, plus a “Choose a subject” state for before anything is picked. The retired certificate gold (#a16207, §3.3) is gone.",
    "ChangePasswordPage": "Palette and type only.",
    "ClassPage": "Card skeleton. Join button becomes the amber call to action — the highest-value action in the product now carries the one accent colour.",
    "CohortImportPage": "The submit button now names what it is loading — “Loading 312 students…” rather than a bare “Loading…”. A button label during a single action is the correct pattern, so no placeholder here.",
    "ContentPage": "Palette and type only; violet page hue removed.",
    "CoursePage": "Card skeleton. The Drive-permissions alert keeps its wording, which is the best error copy in the codebase.",
    "CoursesPage": "Six-card skeleton matching the tile grid. Cover art moved off the twelve-hue rainbow.",
    "DashboardPage": "Both empty widget bodies now say why they are empty. Card skeleton was already correct.",
    "DiscussionPage": "List skeleton. Pink page hue removed.",
    "FeesPage": "Table skeleton at the ledger's column count. Empty statement explains nothing has been billed. Money keeps tabular figures and exact amounts.",
    "FeesPanels": "Inherits the fees treatment; no page head of its own.",
    "GradingPage": "Roster list skeleton. Staff-notes panel still visually separated from the feedback box.",
    "IntegrationsPage": "Table skeleton. Simulated services stay marked so nobody mistakes one for a real send.",
    "LandingPage": "Master logo in the nav and footer. Hero gradient off violet onto navy. Nav is solid white per §10.11. Panel skeleton.",
    "LoginPage": "Full lockup — emblem plus wordmark plus “Dream. Learn. Earn.” The panel gradient ran to violet #6d28d9; it is navy-deep to navy with the §6.3 amber bloom.",
    "MarkingPage": "List skeleton replaces the generic one.",
    "MySubjectsPage": "Already had skeleton and empty state; palette and cover art only.",
    "QuizBuilderPage": "List skeleton.",
    "QuizMarkingPage": "List skeleton.",
    "ReceiptPage": "Card skeleton. Print rules untouched — a receipt is a document somebody is handed.",
    "ReportsPage": "Table skeleton at the results column count. Cyan page hue removed.",
    "RubricsPage": "List skeleton in both panels.",
    "SectionsPage": "Table skeleton for the section table and a panel skeleton for the expanding subject list. Teal page hue removed (§3.3 retires teal by name).",
    "SecurityPage": "Table skeletons. Empty state reframes a nil result as usually the right answer rather than a failure. Fixed-width timestamps kept.",
    "SettingsPage": "List skeleton for the 32 settings. The in-page filter is kept — it is the pattern the command palette generalised.",
    "StructurePage": "Table skeleton.",
    "SubjectPage": "List skeleton.",
    "TemplatesPage": "List skeleton. Live preview kept.",
    "TimetablePage": "List skeleton. Ruled-paper texture now drawn from the amber accent.",
    "UsersPage": "Table skeleton at the directory's column count, and an empty state with a Clear the filters action — the directory is not empty, the filters exclude it.",
    "TrackPage": "New page. FR-REG-020 had an endpoint and no screen, so a tracking reference could only be used by telephoning the office. One field, one button, and a plain-language verdict rather than a status enum.",
    "VerifyPage": "Palette and type only. Public, and unchanged in behaviour.",
    "WatchPage": "Card skeleton. No autoplay, no cross-class recommendations — both kept.",
}

# Work that is known to remain, per page. Named so the checklist cannot read
# as "all done" when it is not.
OUTSTANDING = {
    "UsersPage": "Still a <ul>, not a table, and still shows only the first 25 of `pagination.totalItems` with no page control.",
    "AuditPage": "Still a <ul>, not a table; the API's pagination block is discarded.",
    "BulkPage": "Still a <ul> where a table belongs.",
    "CertificatesPage": "Still a <ul> where a table belongs.",
    "BackupPage": "Still a <ul> where a table belongs.",
    "DiscussionPage": "Still a <ul> where a table belongs.",
    "GradingPage": "Still a <ul> where a table belongs.",
    "QuizBuilderPage": "Still a <ul> where a table belongs.",
    "RubricsPage": "Still a <ul> where a table belongs.",
    "SettingsPage": "Still a <ul> where a table belongs.",
    "SubjectPage": "Still a <ul> where a table belongs.",
    "TimetablePage": "Still a <ul> where a table belongs.",
    "DashboardPage": "Every widget still renders at identical weight; next class is not yet promoted to a hero row.",
    "FeesPage": "No “what is due, and when” sentence for a student — still a ledger they must total themselves.",
}


def scan(src):
    body = re.sub(r"/\*[\s\S]*?\*/", "", src)
    body = re.sub(r"^\s*//.*$", "", body, flags=re.M)
    body = re.sub(r"\{/\*[\s\S]*?\*/\}", "", body)
    return {
        "skeleton": bool(re.search(r"<Skeleton(List|Table|Cards|Page)?\b", body)),
        "bare_loading": bool(re.search(r'className="muted[^"]*">\s*Loading', body)),
        "empty": bool(re.search(r"<EmptyState", body)),
        "error": bool(re.search(r"alert-error|<ErrorState", body)),
        "table": bool(re.search(r"<table", body)),
        "list": bool(re.search(r'className="list"', body)),
        "lines": src.count("\n") + 1,
    }


def tick(v):
    return "✅" if v else "—"


rows = []
for f in sorted(os.listdir(PAGES)):
    if f.endswith(".tsx"):
        rows.append((f[:-4], scan(io.open(os.path.join(PAGES, f), encoding="utf-8").read())))

done = sum(1 for n, s in rows if s["skeleton"] and not s["bare_loading"])
lines = []
w = lines.append

w("# Page-by-page UI checklist")
w("")
w("**Generated by `python scripts/ui-checklist.py`. Do not edit by hand.**")
w("")
w("The status columns are read from the pages themselves on every run. This file")
w("exists because the last checklist in this repository was hand-written, and its")
w("claims about skeleton loading states and striped admin tables described work")
w("that had been designed and never landed.")
w("")
w("Every page listed here received the Brand Guidelines V2.0 palette and type")
w("scale — that arrived through the design tokens, so no page needed editing to")
w("get it. The **What changed** column records what was done *beyond* that.")
w("")
w("| | |")
w("|---|---|")
w(f"| Pages | **{len(rows)}** |")
w(f"| On the brand palette and type scale | **{len(rows)} of {len(rows)}** |")
w(f"| Loading state shaped like its content | **{done} of {len(rows)}** |")
w(f"| Explained empty state | **{sum(1 for _, s in rows if s['empty'])} of {len(rows)}** |")
w(f"| Announced error state | **{sum(1 for _, s in rows if s['error'])} of {len(rows)}** |")
w(f"| Still carrying known work | **{len(OUTSTANDING)}** |")
w("")
w("## Legend")
w("")
w("| Column | Means |")
w("|---|---|")
w("| **Brand** | Palette, typefaces and spacing from Brand Guidelines V2.0 |")
w("| **Load** | A placeholder shaped like the content, not a grey “Loading…” |")
w("| **Empty** | Says *why* it is empty, and offers the next step where there is one |")
w("| **Error** | Failure is announced to a screen reader, not merely displayed |")
w("")
w("## The pages")
w("")
w("| Page | Who sees it | Brand | Load | Empty | Error | What changed |")
w("|---|---|:--:|:--:|:--:|:--:|---|")
for name, s in rows:
    note = NOTES.get(name, "Palette and type only.")
    load = tick(s["skeleton"] and not s["bare_loading"])
    w(
        f"| **{name}** | {ROLES.get(name, '—')} | ✅ | {load} | "
        f"{tick(s['empty'])} | {tick(s['error'])} | {note} |"
    )
w("")

# A note whose page shows no sign of the work is worse than no note.
suspect = [
    n
    for n, s in rows
    if "skeleton" in NOTES.get(n, "").lower() and not s["skeleton"]
]
if suspect:
    w("### Discrepancies")
    w("")
    w("A note below claims work these pages show no sign of. Fix the page or the note.")
    w("")
    for n in suspect:
        w(f"- **{n}**")
    w("")

w("## Known outstanding work")
w("")
w("Named per page so this checklist cannot be read as “all done”.")
w("")
w("| Page | Still to do |")
w("|---|---|")
for name in sorted(OUTSTANDING):
    w(f"| **{name}** | {OUTSTANDING[name]} |")
w("")
w("## Not covered by this pass")
w("")
w("- **Voice and tone (§5).** Copy was not rewritten. The brand book asks for")
w("  conviction over excitement and forbids “course”, “workshop” and “training")
w("  centre”; the interface still says “My subjects” and “Courses”.")
w("- **Photography (§6.2).** No Institute photographs exist in this repository.")
w("- **The screen-reader audit.** Contrast is measured and the mechanical checks")
w("  pass, but whether a screen reads correctly aloud still needs a person.")
w("")

text = "\n".join(lines)

if "--check" in sys.argv:
    current = io.open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    if current != text:
        print("UI-CHECKLIST.md is out of date. Run: python scripts/ui-checklist.py")
        sys.exit(1)
    print("UI-CHECKLIST.md is current.")
    sys.exit(0)

io.open(OUT, "w", encoding="utf-8", newline="\n").write(text)
print(f"Wrote UI-CHECKLIST.md — {len(rows)} pages, {done} with a shaped loading state.")
if suspect:
    print(f"WARNING: {len(suspect)} page(s) have a note the page does not support: {suspect}")
