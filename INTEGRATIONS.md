# Connecting the outside world

A step-by-step guide to the four services the System can talk to.

**None of them is required.** The System runs completely without all four —
every one has a working fallback. Connect them in the order below: the first is
easy and valuable, the last is slow and can wait.

## Before you start

Run this at any time to see where you are:

```bash
node -r dotenv/config scripts/check-integrations.mjs
```

It reads `.env`, tells you what is connected and what each missing one needs.
It never prints a password or a key, so the output is safe to share.

All settings go in a file called **`.env`** in the project root. If you do not
have one yet:

```bash
cp .env.example .env
```

**Restart the API after every change.** None of these is re-read while it runs.

---

| Order | Service | Time | Needs |
|---|---|---|---|
| 1 | **Email** | 10 min | A mailbox you already own |
| 2 | **Google Drive** | 30 min | Google Cloud access |
| 3 | **Google Calendar / Meet** | 20 min | Step 2 done first. **No Workspace admin needed** |
| 4 | **WhatsApp** | Days | A Meta Business account and template approval |

---

# 1. Email

**Do this one first.** It is the quickest, it needs nothing from any company,
and it is the one currently costing you something real.

## Why it matters

When an administrator creates an account, the System shows a temporary password
**once, on screen**. There is no second chance to see it. Without email, the
only way it reaches the person is somebody reading it aloud or pasting it into a
chat — so the password to a student record ends up in a WhatsApp history for
good.

## Step 1 — Turn on 2-Step Verification

Open **<https://myaccount.google.com/signinoptions/two-step-verification>**

Turn it on if it is not already.

> Google **will not offer App Passwords** until this is on — the page will not
> exist. This is the step people skip and then lose an hour to.

## Step 2 — Create an App Password

Open **<https://myaccount.google.com/apppasswords>**

Type a name — `Prepreneurship LMS` — and create it.

Google shows **16 lowercase letters**, like `abcd efgh ijkl mnop`.
**Copy it now.** It is shown once and never again. The spaces are only for
readability; keep them or drop them.

## Step 3 — Put it in `.env`

```ini
MAIL_DRIVER=smtp
MAIL_FROM="Prepreneurship <office@prepreneurship.pk>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=office@prepreneurship.pk
SMTP_PASSWORD=abcdefghijklmnop

PUBLIC_WEB_URL=http://localhost:5173
INSTITUTE_NAME=Prepreneurship
```

`SMTP_USER` must be **the same account** the App Password was created on.

## Step 4 — Check the login, before any student is involved

```bash
node -r dotenv/config scripts/check-email.mjs
```

This connects and verifies the credentials. It sends nothing.

## Step 5 — Send yourself one real message

```bash
node -r dotenv/config scripts/check-email.mjs you@example.com
```

**Check the spam folder as well.** A first message from a `@gmail.com` address
claiming to be an institute often lands there.

## Step 6 — Restart, and confirm on screen

Restart the API, then open **Integrations** in the sidebar. Email should read
**live**.

> ### If you run this through Docker, RECREATE — do not restart
>
> A container is given its environment when it is **created**. `.env` is read
> to interpolate `docker-compose.yml`; it is not injected into a running
> container, and `docker compose restart` re-runs the same container with the
> same environment it already had. So the credentials you just added would not
> reach the API, and it would report itself unconfigured and suppress every
> message — while `check-email.mjs`, which runs on the host and reads `.env`
> directly, passes.
>
> That is not hypothetical: it is exactly what happened here, and it looked
> like the email code not working.
>
> ```powershell
> npm run docker:up      # builds and RECREATES — the one to use
> ```
>
> Then confirm the container actually has them:
>
> ```powershell
> docker compose exec api sh -c 'echo $SMTP_HOST $SMTP_USER'
> ```
>
> An empty answer means it does not, whatever `.env` says.

### ✅ You are done when
The Integrations screen says *live*, and the test message arrived.

Then check the two messages that matter most, because they are the ones a
student actually receives — apply at `/apply` and approve it from
**Admissions**. `ADMISSION-EMAILS.md` is the checklist for that flow.

### If it fails

**`EAUTH` — "username and password not accepted".** This reads like a wrong
password and almost never is. It means one of:

- `SMTP_PASSWORD` is the account's own password, not the 16-letter App Password
- 2-Step Verification is off, so App Passwords do not exist yet
- `SMTP_USER` is a different account from the one the App Password was made on

**Resetting your Google password will not fix any of these.**

**Nothing sends, but the check passed.** `MAIL_DRIVER` is still `log`. That is
the default and it overrides working credentials on purpose — a machine holding
real student data is one announcement away from mailing all of them. Set
`MAIL_DRIVER=smtp` when you genuinely want it live.

### Before you rely on it

- A free Gmail account sends about **500 messages a day**; Workspace about
  2,000. One announcement to 300 students is 300 messages. If you outgrow that,
  move to Amazon SES, Postmark or Mailgun — four lines of `.env` and no code
  change. Nothing in the System names Gmail.
- Mail from `@gmail.com` claiming to be an institute is more likely to be
  filtered. If Prepreneurship owns a domain, send from it and add **SPF and
  DKIM** records. Ten minutes with your registrar, and it is the difference
  between fee reminders arriving and quietly not arriving.

---

# 2. Google Drive

Where lecture recordings live. The System **reads and streams** them — it never
uploads and never deletes. Teachers keep uploading through Drive exactly as they
do now.

> ### Read this before you start
>
> **The adapter is written.** It authenticates as a service account, lists a
> folder, reads durations and thumbnails, checks whether a recording still
> exists, and hands the browser a short-lived address to play from. It was
> built against **the Institute's own Meet recordings** — their real names,
> their real folder-per-class layout — and everything above is covered by
> tests that run without credentials.
>
> **One hop is not yet proven against live Drive**: the redirect that turns a
> file into a playable address. It is unit-tested against a recorded Google
> response and cannot be exercised for real until the service account below
> exists. If Google's behaviour there has changed, playback fails with an error
> that says so rather than quietly working the wrong way.
>
> So the steps below are now the last thing standing between the Institute and
> lecture playback — not the beginning of two days' work.
>
> **Meet in section 3 and WhatsApp in section 4 are still stubs.** Email in
> section 1 is finished and live.

## Step 1 — Create a project

Open **<https://console.cloud.google.com>** → **Select a project** → **New
project**. Name it `prepreneurship-lms`.

## Step 2 — Turn on both APIs

**APIs & Services → Library.** Search for and enable:

- **Google Drive API**
- **Google Calendar API** ← enable this now too; Meet needs it in section 3 and
  doing both saves a second pass

## Step 3 — Create a service account

**IAM & Admin → Service Accounts → Create service account.**

Name it `lms-drive`. When asked for roles, **skip** — none are needed. Click
through to the end.

> A service account belongs to the organisation, not to a person, so access does
> not disappear when a staff member leaves.

## Step 4 — Download its key

Open the account you just made → **Keys → Add key → Create new key → JSON**.

A file downloads. **That file is the credential.** Anyone holding it can read
whatever the account can read.

Move it somewhere outside the project folder, for example
`C:\prepreneurship\service-account.json` or `/etc/prepreneurship/key.json`.

## Step 5 — Point `.env` at it

```ini
GOOGLE_SERVICE_ACCOUNT_JSON=C:\prepreneurship\service-account.json
```

Use a **full path**. A relative one is resolved from wherever the server was
started, which is rarely where you expect.

## Step 6 — Find out who to share with

```bash
node -r dotenv/config scripts/check-integrations.mjs
```

It prints the service account's address — something like
`lms-drive@prepreneurship-lms.iam.gserviceaccount.com`. Copy it.

## Step 7 — Share the lecture folders

In Google Drive, open **each class's recording folder** → **Share** → paste that
address → set it to **Viewer** → Share.

> **Viewer is enough — UNLESS you have turned downloading off.** The System
> only ever reads, and the key it holds asks Google for a read-only scope.
>
> But if the folder has **"Viewers and commenters can't download, print, or
> copy"** switched on, Google refuses to release the file to *any* viewer —
> including the System — and playback fails with
> `403 cannotDownloadFile`. Nothing here can work around that; it is Google
> enforcing your setting, correctly.
>
> If you want students unable to download from Drive itself, keep that setting
> and give the **service account Editor** instead. A writer is exempt from the
> restriction, so the System can stream, while every human viewer stays
> restricted. Students never touch Drive at all — they watch inside the LMS —
> so nothing is loosened for them by this.
>
> Either way, **press "Check the folder" afterwards**: the reply says how many
> recordings are catalogued but blocked, and that number should be zero.

This step is silently skippable and is the usual reason a correct setup returns
an empty folder.

> **If the Institute is on Workspace and the folders are on a Shared Drive**,
> sharing the Shared Drive itself with the service account covers every folder
> in it at once. The System asks for shared-drive results explicitly, so this
> works — but without the share, Drive answers "no files" rather than "no
> access", and an unshared folder looks exactly like an empty one.

## Step 8 — Connect each class to its folder

The Institute already keeps **one folder per class**, which is exactly what the
System expects. Open the class in **Content**, and set its lecture folder to
that folder's id — the long string after `/folders/` in the folder's URL.

Then switch lecture storage over:

```ini
LECTURE_STORAGE=google_drive
```

Restart the API — or `npm run docker:up` if you run it through Docker, since a
container only picks up `.env` when it is recreated.

## Step 9 — Read a folder, and watch one back

Open the class and press **Check the folder**. It reports what it found:
recordings arrive as **drafts**, never published automatically, because a file
appearing in a folder is not a decision to show it to a class.

Publish one, then open it. It should play, remember where you stopped, and
resume there.

### ✅ You are done when
A recording from Drive plays in the browser and the progress bar under its card
moves.

> **What the names give you.** Meet writes recordings as
> `(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording`, and the
> System reads that name rather than the file's timestamps: the card is titled
> *Graphic & UI/UX* and dated **13 August**, the day of the class. Meet finishes
> writing a long evening recording after midnight, so trusting the file's own
> dates puts Monday's class on Tuesday.

### While you wait
`LECTURE_STORAGE=local` (the default) serves video from the application server.
Cataloguing, publication, playback and the weekly integrity check all work
normally. Only the file's location differs.

---

# 3. Google Calendar and Google Meet

Same Cloud project, same service account, same key file as section 2. Nothing
new to download.

> ## Read this first — one thing is not possible
>
> **Google Meet cannot be shown inside the LMS.** Not with Workspace, not with
> any setting, not with any amount of work on our side:
>
> ```
> GET https://meet.google.com/
> x-frame-options: SAMEORIGIN
> ```
>
> That header tells every browser to refuse to display Meet inside another
> site. A recording can be shown in the LMS because it is a file — the server
> fetches the bytes and re-serves them. A live class is a direct connection
> between the student's browser and Google, so there is nothing to fetch.
>
> **What the LMS does own**: the timetable, the countdown, the join window, one
> press to join, the register, and the recording afterwards. The class opens in
> a window; the student never goes hunting for a link. If you need students to
> stay on the page, the video has to move off Meet — see the note at the end of
> this section.

## Before you start — run the checker

```bash
node -r dotenv/config scripts/check-meet.mjs
```

It asks Google directly and prints the one next thing to do. **Run it after
every step below.** It creates nothing except a probe event on the service
account's own calendar, which it deletes immediately.

Right now, on this installation, it says:

```
1. The service account key
  ✓ readable — lms-drive@prepreneurship-lms.iam.gserviceaccount.com
    client ID for domain-wide delegation: 117293134412752348571
2. The Calendar API on the project
  ✓ enabled, and the service account can call it
3. Acting as a real person (domain-wide delegation)
  ✗ GOOGLE_IMPERSONATE_SUBJECT is not set
4. Creating a Meet link
  ✗ refused — Invalid conference type value.
```

So steps 1 and 2 are already done. Start at step 3.

---

## Two routes, and you only need one

Creating a Meet link means acting as a **real person**. A service account
cannot — Google answers `400 Invalid conference type value`, measured against
this very project. There are exactly two ways to give the LMS a person to act
as:

| | Route A — **OAuth 2.0** | Route B — domain-wide delegation |
|---|---|---|
| Needs Workspace admin | **No** | Yes, a super admin |
| Works on personal Gmail | **Yes** | No |
| Set-up | One browser sign-in | Admin console entry |
| Who owns the meetings | The account that signed in | The impersonated user |
| Renewal | Never, once published | Never |

**Route A is recommended** unless you already have the Admin console open. It
is faster, it needs nobody else, and it is what the rest of this section
describes. Route B is at the end.

---

# Route A — OAuth 2.0 (sign in once, no admin needed)

### What OAuth 2.0 is doing here, in one paragraph

The Institute's account grants the LMS permission to use its calendar, in
its own browser, the same way it would grant any app. Google hands back a
**refresh token** — a long-lived credential the LMS exchanges for a working
access token whenever it needs one, without anybody signing in again.
Meetings are then created **as that account**, which is precisely what Meet
requires and what a service account can never be.

Four things to set up, once:

| | |
|---|---|
| **A1** | An OAuth client — who is asking |
| **A2** | A consent screen, published — so the grant does not expire |
| **A3** | The sign-in itself — which produces the refresh token |
| **A4** | Paste it into `.env` and prove it works |

## A1. Create an OAuth client

<https://console.cloud.google.com/apis/credentials?project=prepreneurship-lms>

**Create credentials → OAuth client ID → Application type: `Desktop app`** →
name it `Prepreneurship LMS` → Create.

> **Desktop app, not Web application.** It is the type that accepts a
> `http://localhost` redirect on *any* port, so there is no redirect URI to
> register and nothing to get wrong. A Web application client will refuse with
> `redirect_uri_mismatch`.

Copy the **Client ID** and **Client secret** into `.env`. Both stay
visible on the credential's own page afterwards, so losing the dialogue is
not fatal:

```ini
GOOGLE_OAUTH_CLIENT_ID=1234-abcd.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
```

## A2. Set the consent screen up — and PUBLISH it

<https://console.cloud.google.com/apis/credentials/consent?project=prepreneurship-lms>

If the project belongs to your Workspace organisation, choose **Internal** and
you are finished with this step — no verification, no expiry.

Otherwise choose **External** and fill in the app name, a support email and a
developer email. Those three are the only required fields.

Then add the scope. The page is called **Data access** in the current console
and **Scopes** in the older one; either way, **Add or remove scopes**, and
paste this into the *manually add scopes* box:

```
https://www.googleapis.com/auth/calendar
```

It will be listed as a **restricted** or **sensitive** scope. That is
expected and is not a problem for an app only your own institute uses.

Finally — **this is the step that catches people** — go back to the consent
screen and press **PUBLISH APP**.

> ### The seven-day trap
>
> While the consent screen is in **Testing**, Google **expires every refresh
> token after 7 days**. Everything works, classes schedule perfectly, and then
> a week later it stops with `invalid_grant` and nobody remembers what changed.
>
> **Publish the app.** For your own app used by your own institute, the
> "unverified app" warning is expected and you click through it — verification
> is for apps asking the public for access.

## A3. Authorise, once

```bash
node -r dotenv/config scripts/google-authorise.mjs
```

It prints a URL. Open it **in a browser signed in as the account whose calendar
should hold the classes**, and approve.

> Use a shared account — `classes@` or `office@` — not a teacher's own. A
> teacher leaving would otherwise take every scheduled class with them.
>
> At *"Google hasn't verified this app"*, press **Advanced → Go to … (unsafe)**.
> You are both the developer and the only user.

The script prints who authorised it, and the line to paste into `.env`:

```ini
GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...
GOOGLE_CALENDAR_ID=primary
LIVE_PROVIDER=google_meet
```

**That refresh token is as sensitive as that account's password.** It lives in
`.env`, which is not committed.

## A4. Apply it and prove it

```powershell
npm run docker:up
node -r dotenv/config scripts/check-meet.mjs
```

### ✅ You are done when
Step 3 reads *"a person has authorised the LMS"* and step 4 creates a real
`https://meet.google.com/…` link and deletes it again.

---


## OAuth 2.0 — what goes wrong, and what it means

Every one of these is a real Google error with a cause that its wording does
not give away.

**`redirect_uri_mismatch`** — the OAuth client is a **Web application**, not a
Desktop app. A Web client only accepts redirect URIs registered in advance;
`google-authorise.mjs` uses a loopback port chosen at run time, which only a
Desktop app client accepts. Create a new client of the right type; you can
delete the old one.

**`access_denied` / "Google hasn't verified this app"** — expected for your own
app. Press **Advanced → Go to Prepreneurship LMS (unsafe)**. Verification is
for apps asking strangers for access; you are the developer, the publisher and
the only user.

**The script says "an access token came back but NO REFRESH TOKEN"** — Google
issues one only on the *first* consent, and will not repeat it. Revoke the
LMS at <https://myaccount.google.com/permissions> and run the script again.

**`invalid_grant` a few days after it was working** — almost always the
seven-day trap: the consent screen is still in **Testing**, where Google
expires refresh tokens after a week. Publish the app, then re-authorise. It
can also mean the account's password changed, or somebody revoked the grant.

**`invalid_client`** — the client ID or secret in `.env` does not match the
OAuth client. Copy both again; the secret is shown in full only when created,
but can be re-downloaded from the credential's page.

**`insufficient authentication scopes`** — the grant was made before the
Calendar scope was added to the consent screen. Add it, then re-authorise: an
existing refresh token does not gain scopes it was not granted.

**Everything green on your machine, nothing working in the app** — the
container did not get the settings. `.env` is read when a container is
**created**, not when it restarts:

```powershell
npm run docker:up
docker compose exec api sh -c 'echo ${GOOGLE_OAUTH_REFRESH_TOKEN:+set} $LIVE_PROVIDER'
```

## Looking after the refresh token

It is **as sensitive as that account's password**: anyone holding it, the
client ID and the secret can read and write that calendar until it is revoked.

- It lives in `.env`, which is not committed. Do not paste it into chat, a
  ticket, or a screenshot.
- To revoke: <https://myaccount.google.com/permissions> → Prepreneurship LMS →
  Remove access. Classes stop being created; nothing already scheduled is lost.
- To rotate: revoke, then run `google-authorise.mjs` again.
- It does not expire on a published app, but it **does** stop working if the
  account's password changes or the grant is removed. `check-meet.mjs` says
  which of those happened.

---

# Route B — domain-wide delegation (Workspace admin)

Only if you would rather not sign in, and you have a super admin to hand.

**B1.** Get the service account's client ID. `scripts/check-meet.mjs` prints
it; for this installation it is **`117293134412752348571`**. It is the numeric
*Unique ID*, not the email address, and hunting for it is where this route
usually stalls.

**B2.** <https://admin.google.com> as a **super admin** →
**Security → Access and data control → API controls →**
**MANAGE DOMAIN-WIDE DELEGATION → Add new**

| Field | Value |
|---|---|
| Client ID | `117293134412752348571` |
| OAuth scopes | `https://www.googleapis.com/auth/calendar` |

**B3.** In `.env`:

```ini
GOOGLE_IMPERSONATE_SUBJECT=classes@yourdomain.com
GOOGLE_CALENDAR_ID=primary
LIVE_PROVIDER=google_meet
```

Then `npm run docker:up` and run the checker.

> If **API controls** is not in the menu, you are not a super admin or the
> account is not Workspace. There is no Admin console for a personal Google
> account — use Route A, which does not need one.

## What still has to be built

**Being able to create a link is not the same as the LMS creating one.** The
adapter that turns a scheduled class into a Calendar event is not written yet
(DEP-02). With everything above green, scheduling a class still produces a
class with no link, and the teacher pastes one in.

That work is roughly **a day**, and it cannot be written honestly until the
steps above are green — there would be no way to test it. It is the same
position Drive was in before its credentials arrived.

Until then, and it works today:

1. Teacher creates the meeting in Google Calendar or Meet as they do now
2. Opens the class in the LMS and pastes the link into **Class link**
3. Students press **Join the class** in the LMS, which records attendance

The timetable, join window, register, warnings and recordings are all
unaffected — only the link is manual.

## If you need students to stay on the page

Meet cannot do it, whatever else is configured. The LMS's live-classroom layer
was built to be swapped (ARC-001/ARC-028): the join route already has an
`EMBEDDED_ROUTE` branch, handled by the class page, waiting for a provider that
permits framing. Realistic options are **Jitsi** (free, self-hosted or via
8x8), **Daily.co** or **LiveKit**. That is an adapter and a player page — two
to three days — and teachers would stop using Meet for live classes.

## Troubleshooting, with the exact errors

**`unauthorized_client: Client is unauthorized to retrieve access tokens using
this method`** — step 3 is not done, or the scope in the Admin console differs
from the one requested by even one character. It does **not** mean the key is
wrong.

**`Invalid conference type value`** — the account being used may not create
Meet conferences. Either `GOOGLE_IMPERSONATE_SUBJECT` is unset, so the service
account is acting as itself and never can, or the impersonated user has no
Workspace licence that includes Meet.

**`invalid_grant`** — Google accepts the client but not the user. Check the
spelling of `GOOGLE_IMPERSONATE_SUBJECT`, and that they are a real user in the
Workspace domain.

**`404 Not Found` on the calendar** — `GOOGLE_CALENDAR_ID` names a calendar
that user cannot see. Use `primary` unless you have deliberately made another.

**Everything green on the host, nothing working in the app** — the container
did not get the settings. `.env` is read when a container is **created**:
`npm run docker:up`, not `restart`. Confirm with:

```powershell
docker compose exec api sh -c 'echo $GOOGLE_IMPERSONATE_SUBJECT $LIVE_PROVIDER'
```


---

# 4. WhatsApp

The slowest of the four, and the only one needing a business relationship with a
third party. Leave it until last.

## Step 1 — Meta Business account

**<https://business.facebook.com>** — create one for Prepreneurship if it does
not exist.

## Step 2 — Create an app

**<https://developers.facebook.com>** → **My Apps → Create App** → type
**Business** → add the **WhatsApp** product.

## Step 3 — Register a phone number

> **The number must not already be in use by the normal WhatsApp or WhatsApp
> Business app.** This catches most people. Use a dedicated line — a spare SIM
> is fine.

Note the **Phone number ID** shown beside it. That is an id, not the number.

## Step 4 — Get a permanent token

**Business Settings → System Users → Add**, give it access to the app, then
**Generate token** with `whatsapp_business_messaging`.

> Do **not** use the temporary token on the dashboard. It works perfectly and
> expires in 24 hours — so messaging fails overnight and looks exactly like an
> outage the next morning.

## Step 5 — Put both in `.env`

```ini
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
```

## Step 6 — Submit message templates

Meta requires **pre-approved templates** for anything sent outside 24 hours of
the student writing to you — which is essentially every message this System
sends.

Open **Message wording** in the sidebar. Submit templates to Meta matching that
wording. Approval usually takes a day or two.

### ✅ You are done when
Templates are approved and the Integrations screen says **live**.

### While you wait
Nothing is sent, and the System says so rather than pretending. Students still
receive every notification in their in-app inbox, which is the record. Staff can
read the exact wording that would have gone out under **Integrations →
Simulated outbox** — which is also the easiest way to proofread every message
before a single one is real.

---

# Keeping the credentials safe

`.env` is in `.gitignore` and must stay there. If a credential is ever
committed, pushed, or pasted into a chat, treat it as public and replace it:

| Credential | How to replace it |
|---|---|
| Gmail App Password | Delete it at <https://myaccount.google.com/apppasswords> and create another |
| Service account key | Delete the key in the Cloud Console. The account survives; only the key changes |
| WhatsApp token | Revoke the System User token in Meta Business settings |

Rotating any of them is a `.env` edit and a restart. Nothing else changes —
which is the point of keeping every provider behind an adapter.

**The System will never show you a credential back, on any screen, to anybody —
including a Super Admin.** It reports only whether something is set. A value
that can be read can be leaked, and there is no reason for the interface to be
able to read it.
