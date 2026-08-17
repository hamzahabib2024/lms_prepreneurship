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
| 3 | **Google Meet** | 10 min | Step 2 done first |
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

### ✅ You are done when
The Integrations screen says *live*, and the test message arrived.

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
> **Credentials alone will not switch Drive on.** Unlike email, the Drive
> adapter is a stub: it knows whether it is configured, refuses honestly when it
> is not, and falls back to local storage — but the actual Drive API calls
> (`files.list`, minting a download link) are not written yet. With credentials
> in place it still answers *"Google Drive integration not yet implemented
> (DEP-01)"*.
>
> **Do the steps below anyway.** Nothing can be written or tested against Drive
> until the service account exists, so this is the step that unblocks the work
> rather than the step that finishes it. Roughly two days once the credentials
> are in hand.
>
> The same is true of Meet in section 3 and WhatsApp in section 4. Email in
> section 1 is finished and genuinely does go live on a restart.

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

## Step 7 — Share the lecture folder

In Google Drive, open the folder holding your lecture recordings →
**Share** → paste that address → set it to **Viewer** → Share.

> **Viewer, not Editor.** The System only ever reads. Giving it Editor grants a
> permission nothing uses and that nobody would notice being misused.

This step is silently skippable and is the usual reason a correct setup returns
an empty folder.

## Step 8 — Switch it on

Copy the folder's id from its URL — the long string after `/folders/` — then:

```ini
LECTURE_STORAGE=google_drive
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEf...
```

Restart the API.

### ✅ You are done when
`scripts/check-integrations.mjs` says **live**, and the Integrations screen
agrees.

### While you wait
`LECTURE_STORAGE=local` (the default) serves video from the application server.
Cataloguing, publication, playback and the weekly integrity check all work
normally. Only the file's location differs.

---

# 3. Google Meet

Same project, same service account, same key file. Nothing new to download.

## Step 1 — Confirm Calendar API is on

You enabled it in section 2, step 2. If you skipped it, do it now.

## Step 2 — Grant domain-wide delegation

This is the step everyone misses, and without it Meet fails.

In **Google Workspace Admin** → **Security → Access and data control → API
controls → Domain-wide delegation → Add new**:

- **Client ID**: the service account's client ID (Cloud Console → the service
  account → its Unique ID)
- **OAuth scopes**: `https://www.googleapis.com/auth/calendar.events`

## Step 3 — Restart

### ✅ You are done when
The Integrations screen stops saying the classroom provider is unconfigured.

**It will not create Meet links yet** — the Calendar API calls are not written,
and the provider still refuses with *"Google Calendar integration not yet
implemented (DEP-02)"*. What these steps buy is that the work can now be done
and tested. About a day, on top of the Drive work, since it is the same account
and the same authentication.

### While you wait
Whoever schedules the class pastes the link in. Attendance, the register, the
timetable and the attendance rules are unaffected — only the link is manual.

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

# When the Workspace account is on somebody else's machine

The common case here: you are developing on your own computer and the
Prepreneurship Google Workspace account is signed in on your boss's. Some of
these steps can only be done from that account, so it is worth knowing which
before you sit down with them — **you want one session at their computer, not
four**.

## What you can do alone, now

- **Email with your own mailbox.** Any Gmail account will do for development.
  Use your own, prove the whole pipeline works, and swap `SMTP_USER` and
  `SMTP_PASSWORD` for the Institute's when you have them. Nothing else changes.
- Everything in section 1 up to and including sending yourself a test message.

## What needs their computer, in one sitting

Take this list with you. In order:

1. **Cloud Console** → create the project `prepreneurship-lms`
2. **Enable both APIs**: Google Drive API *and* Google Calendar API
3. **Create the service account** `lms-drive`, no roles
4. **Create a JSON key** and download it — this is the file you need
5. **Copy the service account's email address** (`…@….iam.gserviceaccount.com`)
   and its **Unique ID** (a long number) — you need both later and neither is
   easy to find again in a hurry
6. **Share the lecture folder in Drive** with that email address, as **Viewer**
7. **Copy the folder id** from its URL, the part after `/folders/`
8. **Workspace Admin → Security → API controls → Domain-wide delegation**: add
   the Unique ID with the scope
   `https://www.googleapis.com/auth/calendar.events`
9. **An institute mailbox App Password**, if you are switching email off your
   own account: 2-Step Verification on, then
   <https://myaccount.google.com/apppasswords>

Steps 1–7 need the account signed in. Step 8 needs an **administrator** of the
Workspace, which may or may not be your boss — worth asking before the meeting.

## Getting the key file to your computer safely

**The JSON key is a credential.** Anyone holding it can read whatever the
service account can read. It cannot be rotated by changing a password — the only
remedy is deleting the key in the Console and issuing another.

**Do not** email it to yourself, put it in WhatsApp, paste it into a chat, or
commit it. Those all leave a copy somewhere you cannot delete.

Reasonable ways, roughly best first:

- **Create the key while sitting at their computer, from your own Google
  account**, if your account can be added to the project. Then it downloads to
  your machine and never travels.
- **A USB stick**, deleted afterwards.
- **A password manager** with secure sharing (1Password, Bitwarden) — built for
  exactly this.
- If it must go over the internet, a **one-time secret** link that self-destructs
  on first read, and rotate the key afterwards anyway.

## Where the file goes on your machine

**Outside the repository.** `keys/` and `*.pem` are gitignored, but a JSON
service-account key is neither, and a file inside a repository is one `git add
-A` away from being permanent.

```
Windows   C:\prepreneurship\service-account.json
Linux     /etc/prepreneurship/service-account.json
```

Then in `.env`, a **full path**:

```ini
GOOGLE_SERVICE_ACCOUNT_JSON=C:\prepreneurship\service-account.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEf...
LECTURE_STORAGE=google_drive
```

A relative path is resolved from wherever the server was started, which is
rarely where you expect.

Lock it down so only your account can read it:

```powershell
# Windows — remove inherited permissions, grant only you
icacls C:\prepreneurship\service-account.json /inheritance:r /grant:r "$env:USERNAME:(R)"
```

```bash
# Linux / macOS
chmod 600 /etc/prepreneurship/service-account.json
```

## Checking you have everything before you leave their desk

```bash
node -r dotenv/config scripts/check-integrations.mjs
```

It reads the key file, tells you whether it is valid JSON with the fields
required, and **prints the service account's email address** — which is the one
thing everybody has to go back for, because it is needed to share the folder.

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
