# Recordings: Google Drive to a student's screen

What was built, what was found, and what is still unproven. Written against
**the Institute's own Meet recordings** — real folders, real names — rather than
against Google's documentation.

---

## What the Institute actually has

One Drive folder per class, filling up automatically as Meet finishes writing
each recording:

```
📁 (Sec D) Graphic & UI/UX        📁 (Sec I) English        📁 Sec-H Graphic
   └─ (Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording
   └─ (Sec D) Graphic & UI/UX Class - 2026/08/07 20:41 PKT - Recording
   └─ Sec D - UI UX CLASS - 2026-06-16- recording
   └─ Chat.txt, Transcript
```

Eighteen recordings in that one folder. That layout maps exactly onto what the
System already expected — a `lectureFolderRef` per class — so nothing about how
teachers work has to change.

---

## The defect this found

**Every single recording was invisible to the System.**

The sync decided "is this a video?" by testing the filename against
`/\.(mp4|mov|webm|mkv|avi)$/`. A Google Meet recording in Drive is

```
name:      (Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording
mimeType:  video/mp4
extension: (none)
```

**No extension. Not one of them.** So the answer was "no" eighteen times out of
eighteen. The hourly sweep ran, found the folder, read it correctly, catalogued
nothing, and reported success. The course page stayed empty while the folder
filled up — a silence, not an error, and nothing anywhere to investigate.

It survived because both neighbours were right. The listing was read correctly;
the filename rules were tested and correct about the names they were given. The
fault was in the seam, and the seam only shows against real data — every test
fixture said `lecture-04-typography.mp4`, which is what a developer imagines a
recording is called.

The filter now asks the provider what the file **is**, and falls back to the
extension only for providers that cannot say (local disk, which has nothing but
the name).

---

## What was built

### The Drive adapter — no longer a stub

| | |
|---|---|
| **Authentication** | Service account, signing its own JWT assertion. No `googleapis` dependency: that library is large and all it would do here is sign a token and make four REST calls |
| **Listing** | `files.list` with pagination, shared-drive support, durations, sizes and thumbnails |
| **Existence** | `stat` returns null — never throws — for deleted, binned or unshared files, so one revoked share marks one lecture MISSING instead of abandoning a sweep over the whole Institute |
| **Playback** | A short-lived address the browser fetches directly |
| **Writing** | Refuses. The scope asked of Google is **read-only**, so it could not write even if asked |
| **Health** | Actually reaches Drive. A check that only reads configuration reports healthy while the key is revoked, the clock is wrong, or the folder was never shared — which are the three ways this breaks |

### Reading a recording's name

Meet's names carry two things worth having, and the parser is tested against
eleven real ones including every awkward variant in the Institute's folders:

**The date is the class's date.** Meet finishes writing a long evening recording
well after it ends — a 21:53 class lands in Drive the following day. Dating
cards by the file's timestamp puts Monday's class on Tuesday, which is the kind
of small wrongness that makes students stop trusting the list.

**The title is the subject.** `(Sec D) Graphic & UI/UX Class - … - Recording`
becomes **Graphic & UI/UX**. The section marker is noise on a card that already
sits inside that section, and so are the organiser's notes to themselves —
`Recorded for …`, `(For Sec D Recording) …` — both of which are real.

The time is deliberately **discarded** after the date is taken. Meet writes it
in the organiser's timezone with an abbreviation (`PKT`) and no offset, so it
cannot be turned into an instant without knowing where they were sitting. Dates
are stored at midday UTC so the same class shows the same day in Karachi and in
New York.

### The interface

A **watch page** at its own address — `/courses/:class/watch/:lecture`:

```
┌──────────────────────────────────────────┬────────────────────────┐
│  ‹ Graphic Designing                     │  Graphic Designing     │
│  ┌────────────────────────────────────┐  │  9 recordings          │
│  │                                    │  │ ┌────────────────────┐ │
│  │           ▶                        │  │ │ ▶ ▓▓▓ 13 Aug       │ │
│  │                                    │  │ │ 2 ▓▓▓ 7 Aug        │ │
│  └────────────────────────────────────┘  │ │ 3 ▓▓▓ 6 Aug        │ │
│  Graphic & UI/UX                         │ │ 4 ▓▓▓ 4 Aug        │ │
│  13 August 2026 · 1:12:11 · ✓ watched    │ │ …                  │ │
│  ┌────────────────────────────────────┐  │ └────────────────────┘ │
│  │ NEXT IN THIS CLASS  Grid systems › │  │                        │
└──────────────────────────────────────────┴────────────────────────┘
```

The shape everybody already knows, so nobody has to be taught where the next
lecture is. Three deliberate departures from YouTube:

- **No autoplay.** A recording that starts talking on its own — in a shared
  room, in a class — is the most complained-about behaviour on the web.
- **No recommendations from other classes.** The list is this class, in order.
- **No view counts.** A class of thirty is not an audience, and the number would
  only ever be discouraging.

**Cards are links, not buttons opening a dialog.** Watching is a place you go:
it has an address, so it can be bookmarked, opened in a new tab, and returned to
with the back button — all of which a modal takes away and all of which students
expect from anything that plays video.

**Thumbnails are drawn, not fetched.** Drive does return a `thumbnailLink` and
it is not used, for three reasons: those URLs identify the file, which is a
storage reference reaching a student by another name (ARC-041); they expire
quietly, and a grid of broken images is the worst-looking failure a catalogue
can have; and the first frame of a Meet recording is an empty meeting room. So
each recording gets deterministic artwork from its own title — no files, nothing
to host, nothing to expire, and a recording synced this morning has a thumbnail
this morning.

Duration sits bottom-right where every video service puts it, and a red line
under anything already started, at 2% or more — a 1% bar on a lecture that was
opened and closed is noise.

---

## Playback, and the one thing not yet proven

**Drive has no signed URLs.** There is no equivalent of an S3 presigned link,
and the two obvious ways round that are both wrong:

| | Why not |
|---|---|
| Share the file publicly and hand out `webContentLink` | A permanent public link to a class recording, valid for anyone who ever sees it, forever. Breaks ARC-041 absolutely |
| Stream the bytes through the API | 150 concurrent streams is the entire provisioned bandwidth, spent copying files Google is already serving. Breaks ARC-052 and §3.8 |

What Drive does have: a request for the file's bytes carrying the service
account's token answers **302** to a short-lived `googleusercontent.com` address
that carries its own authorisation. Following that redirect *without reading the
body* gives exactly what ARC-052 asks for — a URL the browser fetches directly,
expiring on its own.

**That hop is unit-tested against a recorded Google response and has NOT been
run against live Drive**, because that needs the service account. If Google
answers 200 with the bytes instead of redirecting, playback fails with an error
that says precisely that, rather than silently proxying 133 MB per student.

That is the one thing in this work that credentials will either confirm or
disprove. Everything else is exercised by tests today.

---

## Verified

| | |
|---|---|
| **51 tests** across the parser, the adapter and the sync chain | all passing |
| Every fixture is a **real** Drive response or a **real** recording name | listing shape and filenames read from the Institute's folders |
| The old filter **fails** the new suite | reverted deliberately: 3 recordings expected, 0 catalogued |
| Three Drive regressions caught | dropping shared-drive support, following the redirect, dating by `modifiedTime` |
| A student sees **only published** recordings, and no folder reference | checked over HTTP against the running stack |
| No storage reference in any response a student receives | checked over HTTP |
| **1,227 tests, 56 suites, 0 lint errors** | |

### Not verified

- **The redirect hop**, as above.
- **How it behaves on a Shared Drive.** The flags are set and tested; whether
  the Institute's sharing is arranged the way the System expects can only be
  found out with the key.
- **Playback of a 363 MB recording over a Pakistani connection.** Seeking uses
  HTTP range requests and Google's hosts support them, but the experience at
  that size on a phone is a real question that measurement will answer and
  reasoning will not.

---

## Turning it on

`INTEGRATIONS.md` section 2 has the full walkthrough. In short:

1. Service account in Google Cloud, Drive API enabled, JSON key downloaded.
2. `GOOGLE_SERVICE_ACCOUNT_JSON` — the file's path, or the JSON itself.
3. **Share each class folder with the service account's address, as Viewer.**
   Skipping this is the usual cause of "the folder is empty": Drive answers *no
   files* rather than *no access*.
4. Set each class's lecture folder to its Drive folder id.
5. `LECTURE_STORAGE=google_drive`, then **`npm run docker:up`** — a container
   only picks up `.env` when it is recreated, not when it is restarted.
6. Press **Check the folder** on a class. Recordings arrive as **drafts**;
   publish one and watch it back.

Until then `LECTURE_STORAGE=local` serves video from the application server, and
cataloguing, publication, playback and the integrity check all work normally.
Only the file's location differs.
