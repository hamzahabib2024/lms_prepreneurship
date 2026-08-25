# User manuals

Four Word documents, one per role. Regenerate them with:

```
pip install python-docx
python scripts/manuals/student.py
python scripts/manuals/teacher.py
python scripts/manuals/admin.py
python scripts/manuals/superadmin.py
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
