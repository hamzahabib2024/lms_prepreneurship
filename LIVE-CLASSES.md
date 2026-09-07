# Live classes: setting up, starting, joining

Classes now run **inside the LMS**. A student presses Join on the class page and
the lesson opens there — no second site, no link in a WhatsApp group, no account
on somebody else's service.

This is the whole of it: how to set the classroom up, how a teacher holds a
class, how a student joins, and what to do when something does not work.

> **Google Meet is not needed for this, and never actually worked.** The Meet
> adapter in this System has always been a stub — it has never created a
> meeting. What the Institute has been doing is the `manual` provider: a teacher
> makes a link by hand, in Meet or Zoom or anything else, and pastes it in. That
> stays available as the fallback and should not be removed.

---

## Part 1 — Setting up the classroom server

### 1.1 It needs its own machine

Do not put this on the application server. It is not a question of spare
capacity — LiveKit forwards media packets in real time, and a slow database
query is invisible where 200 ms of jitter is a class that stutters.

[DEPLOYMENT.md §1.2b](DEPLOYMENT.md) sizes it. The short version: **what you are
buying is bandwidth, not CPU.** One teacher to thirty students is about 50 Mbps
and roughly **20 GB an hour**; three concurrent classes four hours a day is
about **5 TB a month**. Check what your provider includes before committing.

### 1.2 Start it

The service sits behind a compose profile, so it never starts by accident on a
box that cannot carry it:

```bash
docker compose --profile livekit up -d livekit
```

Check it is answering:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7880   # expect 200
docker logs lms_prepreneurship-livekit-1 --tail 20
```

### 1.3 Generate real keys

The keys committed to this repository are **development values, published in
public**. Anybody holding them can mint a token for any room on your server.

```bash
docker run --rm livekit/livekit-server generate-keys
```

Put the pair in `docker/livekit.yaml` under `keys:` and in `.env` below. They
must match exactly or every join fails with a token error.

### 1.4 The settings the LMS needs

In `.env` on the server — **not** in `.env.example`, and never committed:

| Setting | What it is |
|---|---|
| `LIVEKIT_URL` | The address a **student's browser** dials. `wss://` in production. |
| `LIVEKIT_API_URL` | Where the **API** reaches LiveKit, when that differs. Leave unset on a normal server; docker compose sets it for you. |
| `LIVEKIT_API_KEY` | From `generate-keys`. |
| `LIVEKIT_API_SECRET` | From `generate-keys`. Treat as a password. |
| `LIVEKIT_TOKEN_TTL_MINUTES` | How long a join token stays valid. Default 240. A ceiling, not a schedule — the join window is enforced separately. |
| `LIVE_PROVIDER` | Leave at `manual`. Sections are moved over one at a time — see Part 2. |

**Why there are two URLs.** Under docker compose the browser dials the published
port (`localhost:7880`), but inside the API container that same name is the API
container itself, so every management call is refused and a perfectly healthy
classroom reports as down. Measured on this stack: `livekit:7880` answers,
`localhost:7880` does not. On a server where LiveKit has one public hostname,
set `LIVEKIT_URL` only and let the API derive the rest.

### 1.5 Ports

| Port | Why it matters |
|---|---|
| 443/TCP | HTTPS and TURN over TLS |
| 80/TCP | Certificate issuance |
| 7880/TCP | Signalling — put nginx and TLS in front of it |
| 7881/TCP | WebRTC over TCP. **The fallback students on school and office Wi-Fi arrive on** |
| 7882/UDP | The media itself. Closed, people connect, see each other listed, and **no video ever appears** |
| 3478/UDP | TURN |

### 1.6 Before a real cohort

Three things, and the third is the one that gets skipped:

1. **`use_external_ip: true`** in `docker/livekit.yaml`. Left false on a public
   server, clients are handed an unroutable `172.x` address and never connect.
2. **TLS.** A browser refuses a `ws://` connection from an `https://` page, so
   `LIVEKIT_URL` must be `wss://` and the server needs a certificate.
3. **TURN on 443.** Without it, students whose network passes nothing else
   simply cannot join — and they will report it as "the LMS is broken", not as a
   network problem.

### 1.7 Check it worked

Sign in as a Super Admin or Admin, open **Sections**, press **Edit** on any
batch and open the **Classroom** dropdown. Each provider is listed, and one that
cannot be reached says **— unavailable** beside its name. That is the same
health check the Super Admin integrations screen shows.

---

## Part 2 — Turning it on for a batch

Providers run side by side, so the Institute moves **one batch at a time** and
everything else carries on unchanged.

1. **Sections** → find the batch → **Edit**
2. **Classroom** column → choose **Livekit**
3. **Save**

The column shows a green pill for a batch on a healthy classroom and an amber
one where the provider is unreachable or the key does not match a registered
provider. `Institute default` means the batch follows `LIVE_PROVIDER`.

Watch one real class on that batch before widening.

> ### Classes already in the diary keep their old room
>
> A class is bound to its provider **when it is scheduled**, once. Switching the
> batch does not go back and give next week's existing classes a LiveKit room —
> those will say *"The classroom is not ready yet."*
>
> **After switching a batch, generate its classes again** (Part 3A). Any class
> caught in between can be rescued with a fallback link — see Part 7.

---

## Part 3 — Holding a class (teacher)

### 3A. Classes booked in advance

**Timetable** → set the pattern — which days, what time, over what date range —
→ **Preview** to see exactly what would be created → **Generate**.

Each occurrence is created as an ordinary class, with its own room, its own
attendance register and its own entry in the audit log.

### 3B. A class right now

On your **Dashboard**, the first card is **Start a class now**.

1. **Which class** — the subject and batch you are taking
2. **For how long** — 30 minutes to 2 hours
3. **Start now**

You land in the room. Students see it on their dashboard as the next class and
join the same way as any other.

Use it for the things that never used to reach the LMS at all: a revision hour
called after a bad assessment, a cancelled slot picked up, a topic that needs
one more hour tomorrow.

The length you choose is not a countdown — it is how long the class holds your
diary. You cannot be booked in two places at once, so a two-hour class you
finish in twenty minutes will refuse you the next room until you end it.

### 3C. Ending the class

On the class page, beside the **live now** badge: **End the class**.

It asks first, because it ends the lesson for everyone and disconnects anybody
still in the room. Use it when you finish early — it frees your diary for the
next class and closes the room behind you.

---

## Part 4 — Joining a class (student)

**Dashboard** → **Join class** on the next-class card. Or **Timetable** → the
class → **Join**.

**When the door opens.** Fifteen minutes before the start by default; a class
started on the spot is open immediately. The teacher can go in early to set up,
students cannot. The page counts down on its own and opens itself when it is
time — there is nothing to refresh.

The class stays open until fifteen minutes after it was due to end, then the
page says the class has finished.

### The screen before the class

You are not dropped straight into the lesson. First you see yourself:

- **Your own camera preview**, mirrored, so raising your right hand looks right
- **Camera on / off** and **Microphone on / off** — decide before anybody can
  see or hear you
- **Camera** and **Microphone** pickers, shown only if you have more than one

Then **Join the class**.

If your browser refuses the camera, or another program is holding it, you are
told so — and the Join button still works. A broken webcam is not a reason to
miss a lesson.

---

## Part 5 — Inside the classroom

| Control | Who has it |
|---|---|
| Camera and microphone | Everyone |
| Chat | Everyone |
| Screen share | **Teacher only** |
| Mute or remove somebody | **Teacher only** |
| Focus one person, grid view, pagination | Everyone |
| Full screen | Everyone |
| Leave | Everyone |

**Screen share is the teacher's alone**, and that is enforced in the token
itself rather than by hiding a button — a student sharing their screen over a
lesson is the failure every institute reports.

**Full screen** is worth knowing about. The class renders in a frame beside the
sidebar, which is right for glancing at a lesson and too small for following
one.

**A patchy connection says "reconnecting"** rather than freezing silently, so
students wait instead of giving up and leaving.

**Leaving is not final.** The page offers **Rejoin the class** — someone who
closes the tab by accident presses one button.

---

## Part 6 — Attendance

**What happens automatically:** a student's join is recorded the moment they are
let into the class. That is evidence they were there, and it happens whichever
provider the batch is on.

**What still decides the register:** the teacher, or self check-in, exactly as
before. Nothing about attendance changed when live classes moved into the LMS.

**What the classroom does not do:** it does not work out attendance from how
long somebody stayed. LiveKit reports who is connected *at this instant*, not a
join and leave history, so the System declares that capability absent rather
than publishing a figure that would quietly under-report every class. See
Part 8.

---

## Part 7 — When it goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **"The classroom is not ready yet"** | The class has no room — usually a class scheduled *before* its batch was moved to LiveKit | Generate the batch's classes again (Part 3A), or set a fallback link below |
| **"The classroom is not available yet"** | LiveKit is not configured, or the key and secret do not match the server | Check the four `LIVEKIT_*` settings against `docker/livekit.yaml` |
| **"This classroom link is not valid"** | The token was mangled or has expired | Go back to the class page and press Join again — a fresh one is issued each time |
| Everyone connects, **nobody sees video** | UDP is blocked | Open **7882/UDP**. Confirm `use_external_ip: true` on a public server |
| **Some students** cannot join, most can | Their network passes neither UDP nor plain TCP | Turn on **TURN over TLS on 443**. There is no fix on the student's side |
| **"— unavailable"** beside a provider | The API cannot reach LiveKit | If both are containers, check `LIVEKIT_API_URL` — see §1.4 |
| **"This teacher already has … at that time"** | You are booked elsewhere; two places at once is refused | End the class you are in, or use the one already scheduled |
| Camera works nowhere in the LMS | Browser permission, or another program holds it | Allow camera and microphone for the site; close Zoom, Teams, or anything else using it |

### The fallback link

When the classroom is unreachable mid-class, a link the teacher supplies takes
priority over the room — students are sent to it instead, and the class happens.
This is checked before everything else, so it works even when LiveKit is
completely down.

**There is no screen for it yet.** Today it is an API call:

```
POST /api/v1/live-sessions/{sessionId}/fallback-link
{ "joinUrl": "https://…" }
```

The per-class standing link on **Sections → Subjects** is a different thing: the
room a class uses every week under the `manual` provider.

---

## Part 8 — What this does not do yet

Neither is a defect; both are decisions worth taking knowingly.

**Attendance is not derived from the classroom.** Doing it properly means
receiving LiveKit's join and leave webhooks and storing them, which needs a new
endpoint and a new table — and that crosses the provider boundary the
substitution test at §3.4.6 protects. Until then attendance works as it always
has.

**Classes are not recorded.** LiveKit can record, but it needs a separate Egress
service and somewhere to put the output, and unlike the classroom itself that
work *does* re-encode video and is CPU-hungry. Recorded lectures continue to
come from the existing recordings pipeline.

---

## The short version

| I want to… | Where |
|---|---|
| Turn the classroom on for a batch | Sections → Edit → Classroom → Livekit |
| Book classes for the term | Timetable → pattern → Preview → Generate |
| Start a class right now | Dashboard → Start a class now |
| End a class early | Class page → End the class |
| Join a class | Dashboard → Join class |
| Check the classroom is up | Sections → Edit → Classroom dropdown |
