# User manuals and the QA pack

Five Word documents. They are written **into the repository root**, not into
this directory, because they are documents the Institute HANDS TO PEOPLE — a
QA engineer, a new teacher, a student on their first day. A document three
directories down is one only a developer ever finds.

- `Prepreneurship LMS - Student Guide.docx`
- `Prepreneurship LMS - Teacher Guide.docx`
- `Prepreneurship LMS - Administrator Guide.docx`
- `Prepreneurship LMS - Super Administrator Guide.docx`
- `Prepreneurship LMS - QA Test Pack.docx`

Regenerate them with:

```
pip install python-docx
python scripts/manuals/student.py
python scripts/manuals/teacher.py
python scripts/manuals/admin.py
python scripts/manuals/superadmin.py
python scripts/manuals/qa_pack.py
```

They are generated rather than hand-written so that the screen lists stay in
step with `apps/web/src/navigation.ts` — a manual describing a screen that has
been renamed is worse than no manual, because somebody follows it.

Each is written FOR THE PERSON WHO HAS THE ROLE, not for somebody reading
about the software. The student guide never says "section-subject"; the
administrator guide says what a decision costs rather than which button makes
it; the super-administrator guide is mostly about restraint, because almost
everything unique to that role is irreversible, invisible to the person it
affects, or both.

The QA pack is the odd one out: it is written for somebody whose job is to
try to break the System. Its last section, *Things that look like bugs and are
not*, exists because eight behaviours found during automated QA look like
defects and are the System working correctly — a tester who reports all eight
wastes a day, and so does the person reading the report.
