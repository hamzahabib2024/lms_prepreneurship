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

Four things in the System mint a temporary password: admitting an applicant,
importing a cohort, creating a staff account, and resetting somebody's password.
**All four email it to the person it belongs to**, and all four still show it
once on the administrator's screen, because delivery is never certain.

A fifth message carries no password at all and matters just as much: a student
the Institute **already has**, enrolled in another course. Their account is
untouched, so sending them credentials would be a lie about their sign-in — but
saying nothing, which is what the System used to do, leaves somebody who has
just paid a fee and attached a slip hearing absolutely nothing back while a
first-time applicant doing the same thing gets a welcome. They are told they are
enrolled, that their registration number is unchanged, and — in as many words —
that there is no new password and none is coming.

Without email configured, none of them can send. The password is then shown on
screen and nowhere else, so the only way it reaches its owner is somebody
reading it aloud or pasting it into a chat — the password to a student record,
in a WhatsApp history for good. For eight students in a room that is survivable.
For the hundred-row cohort import it is not: an operator will not relay a
hundred passwords by hand, so in practice the accounts go unused.

Every screen that issues one now says whether it also arrived by email, and the
cohort import marks the rows that did not — those are the only ones anybody has
to chase.

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

### How much a Google account will send in a day

This is the limit that actually bites an institute, and it is worth knowing
before a cohort of two hundred is imported rather than after.

| Account | Messages a day | Recipients per message over SMTP |
|---|---|---|
| Free `@gmail.com` | **500** | 500 |
| Workspace, paid | **2,000** | 100 over SMTP (2,000 via the API) |
| Workspace, trial | **500** | 100 over SMTP |

The window is a **rolling 24 hours, not a calendar day**, so the allowance
comes back gradually as the oldest sends age out rather than all at once at
midnight. Google's own wording is that a blocked account can usually send again
"within 1 to 24 hours".

An exhausted account answers every attempt with:

```
550-5.4.5 Daily user sending limit exceeded
```

**Nothing is wrong when you see that.** Not the addresses, not the App
Password, not the settings. The System now keeps those messages instead of
losing them — see below — so the ordinary response is to do nothing.

> **A message that is refused for the day is queued, not dropped.** It is
> retried every half hour until it goes. A credentials email held over this way
> arrives as a **link to choose a password** rather than the original temporary
> one, because that password is hashed the moment it is made and cannot be read
> back by anybody. The temporary password on the import screen keeps working, so
> nothing already written down is invalidated — the student simply has two ways
> in instead of one.
>
> A refusal that will never clear — no such mailbox, a rejected App Password —
> is **not** queued. It is reported for a person to fix, because retrying it
> sixty times spends the very allowance the messages behind it are waiting for.

To check whether mail leaves at all, and to see the server's own words when it
does not:

```bash
npm run mail:test -- someone@example.com
```

> **Where an applicant sends the money is NOT here.** The bank account, the
> account name and the payment instructions live in **Settings → Payments**,
> not in `.env`, because an institute changes bank and that should not need a
> deployment. Until they are filled in, the application form tells applicants to
> ask the office — which is honest, and was the only thing it could say before
> the fee panel existed at all.

> **`PUBLIC_WEB_URL` is not decoration.** It is the address a new student is told
> to sign in at, and the address of the "track your application" link. Left at
> `http://localhost:5173` in a real deployment, every student is emailed a link
> to *their own computer*, which works for nobody and reads as the System being
> broken rather than misconfigured. If it is empty the System falls back to
> `WEB_ORIGIN` — set in every deployment because CORS does not work without it
> — and only then to localhost.

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
> **Meet in section 3 is still a stub.** Email in section 1 and WhatsApp in
> section 4 are both finished: the WhatsApp adapter sends real template
> messages through the Meta Cloud API, and all that is missing is the three
> settings section 4 collects.

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

Give the **folder** and the **filename** separately:

```ini
GOOGLE_CREDENTIALS_DIR=C:\prepreneurship
GOOGLE_SERVICE_ACCOUNT_FILE=service-account.json
```

Use a **full path** for the folder. A relative one is resolved from wherever the
server was started, which is rarely where you expect.

> **Why two settings rather than one.** Docker cannot see a path on your
> machine, so `docker-compose.yml` mounts `GOOGLE_CREDENTIALS_DIR` into the
> container at `/run/credentials` and composes the two into the single variable
> the API reads. Writing the pair means the same two lines work whether you run
> the API with `npm run dev`, `npm start`, or in Docker.
>
> **This was a real fault, not a preference.** Until it was fixed, the API,
> the integrations screen and `check-integrations.mjs` all read only the
> composed variable — which nothing but docker-compose sets. Outside Docker, a
> valid key in the right place with the folder correctly shared reported
> *"Google Drive: not configured"*, and lectures fell back to local storage
> without an error anywhere. Three tools agreeing on a wrong answer is why
> nobody suspected the answer.

There is still one variable, for a container platform that has environment
variables and no filesystem to mount. Set it to a path, or paste the key's JSON
into it whole, on one line. If it is set it wins over the pair above:

```ini
GOOGLE_SERVICE_ACCOUNT_JSON=/run/secrets/service-account.json
```

## Uploading a lecture INTO Drive — read this before trying

The System can read the Institute's recordings with the setup above. Putting a
recording **into** Drive from somebody's laptop is a different grant, and there
is one constraint that no amount of sharing fixes:

> **A Google service account has no Drive storage quota.**
>
> It will list your folder, read every file in it, and Drive even reports
> `canAddChildren: true` — and the upload is refused with
> `storageQuotaExceeded`. A file in an ordinary My Drive has to be charged to
> somebody, and a service account is nobody. This was measured against this
> Institute's own project, not read in a document.

Two ways out, and only one of them is likely to suit you:

| | What to do | Cost |
|---|---|---|
| **Shared Drive** | Move the Recordings folder to a Shared Drive and share that with the service account as **Content manager** | Needs Google Workspace |
| **Impersonation** | Set `GOOGLE_IMPERSONATE_SUBJECT` to a Workspace user and grant domain-wide delegation in the Admin console | Needs Workspace admin |

```ini
GOOGLE_IMPERSONATE_SUBJECT=office@prepreneurship.pk
```

**You do not have to do either.** The upload panel asks the question before it
offers a file picker, says which of these applies, and offers to store the
recording in the System itself instead — students watch it in exactly the same
way. Nothing is blocked; only the destination differs.

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

Press **DOWNLOAD JSON** and drop the file into the folder that already holds
the service-account key:

```
E:/vs code/git/LMS@Prepreneurship/CREDENTIALS/
```

That is all there is to this step. The script in A3 finds the file there and
writes the values into `.env` itself — nothing to copy by hand, and nothing
to paste half of.

> Prefer not to keep the file? Put the two values in `.env` yourself and the
> script uses those instead. Both remain visible on the credential's own page
> afterwards, so closing the dialogue is not fatal.
>
> ```ini
> GOOGLE_OAUTH_CLIENT_ID=1234-abcd.apps.googleusercontent.com
> GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
> ```

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

It prints **who** authorised it, and writes everything into `.env` for you:

```ini
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=...
GOOGLE_CALENDAR_ID=primary
LIVE_PROVIDER=google_meet
```

**The token is never printed to the terminal**, deliberately: terminals get
scrolled back, screenshotted and pasted into chats, and that token is as
sensitive as the account's password. It exists in `.env` — which is not
committed — and nowhere else.

Check the address it names is the one you meant. Authorising as the wrong
Google account is the commonest mistake here, and it stays invisible until
classes start appearing on somebody's personal calendar.

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
third party. Two things make it much less work than it looks:

**The System only SENDS.** There is no webhook, no callback URL, no inbound
message handling, nothing to expose to the internet. Most guides on the web walk
you through webhook verification because they are describing a chatbot. Skip all
of it — if a screen asks for a callback URL, you are in the wrong place.

**Three settings and it is live.** The adapter, the retry wording, the delivery
log, the error explanations and the Integrations screen are all built already:

```ini
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_NAME=
```

The third one is the part everybody misses, and section 4.5 is about nothing
else.

> **If the Institute already runs Facebook or Instagram ads, step 1 is done.**
> The Business Portfolio the ads run under is the same object WhatsApp attaches
> to. You are joining an existing account, not creating one.

## Step 1 — Find the Business Portfolio you already have

**<https://business.facebook.com>** → the account switcher at the top left.

If Prepreneurship is listed, use it — do not create a second one. Two portfolios
for one institute is how the ads team and the LMS end up on different accounts
with the phone number stranded on the wrong one.

Note whether it says **Verified** under Business settings → Business info.
Unverified works for testing; it caps how many people you can message a day and
must be finished before real use. Verification wants a utility bill or a
registration certificate in the Institute's name and takes a few days, so if it
is not done, start it NOW and carry on with the rest while it processes.

## Step 2 — Create an app

**<https://developers.facebook.com>** → **My Apps → Create app**.

- Use case: **Other**, then app type **Business**.
- **Business portfolio: the one from step 1.** This dropdown is the whole reason
  step 1 came first.

On the app dashboard, find **WhatsApp** and press **Set up**. That creates a
**WhatsApp Business Account (WABA)** under the portfolio.

## Step 3 — The phone number

WhatsApp → **API setup**. Meta gives you a **test number** immediately, and it is
genuinely useful — it sends real messages, free, to a handful of numbers you
nominate. Use it for the whole of steps 4 to 7 and add the Institute's real
number later.

> **The real number must not be signed in to the ordinary WhatsApp or WhatsApp
> Business app anywhere.** This catches most people. Registering it here takes it
> off those apps permanently. Use a dedicated SIM — never somebody's personal
> number, and never the number on the website that people already message.

Copy the **Phone number ID** shown beside the number. It is a long number like
`123456789012345` and it is **not** the phone number. That value is
`WHATSAPP_PHONE_NUMBER_ID`.

## Step 4 — A permanent token

The token on the API setup page works perfectly and **expires in 24 hours**. Use
it to test if you like, but if you put it in `.env` the messaging stops
overnight and looks exactly like an outage the next morning.

For the real one: **business.facebook.com → Business settings → Users → System
users → Add**.

1. Create a system user, role **Admin**.
2. **Add assets** → your app → toggle **Manage**.
3. **Generate new token** → pick the app → expiry **Never** → scope
   **`whatsapp_business_messaging`**.

That one scope is all the System uses, because all it does is send. Meta's own
guides also tick `whatsapp_business_management`, which grants the power to
create and delete templates through the API — this System never does, and a
token that can rewrite the Institute's approved templates is a token worth
being careful with. Leave it off unless something else needs it.

Copy it the moment it appears. Meta will not show it again. It starts `EAA…` and
is a few hundred characters. That value is `WHATSAPP_ACCESS_TOKEN`.

## Step 5 — The template, which is not optional

**This is the step that decides whether anything ever arrives.**

Meta opens a **24-hour customer service window** when a person messages your
number. Inside it you may send free text. Outside it you may send **nothing but a
pre-approved template**.

Every message this System sends is outside that window. A student never messages
the Institute first — they are told their attendance is slipping, that a fee is
due, that a mark has been released. So free text would be refused for every
recipient the Institute has.

It fails in the most expensive way imaginable: the token works, the number is
right, and your own test message succeeds — because *you* messaged the number
while setting it up, so you are inside the window. Then every real student gets
nothing.

### One template, two parameters — not one per message

The adapter sends **a single template** and passes the notification's title and
body into it. You do **not** submit a template per message type, and you do not
need to match the wording under **Message wording** in the LMS sidebar. One
approved template carries every notification the System sends.

**WhatsApp Manager → Message templates → Create template**

| Field | Value |
|---|---|
| Category | **Utility** |
| Name | `lms_notification` (lower case, underscores — this becomes `WHATSAPP_TEMPLATE_NAME`) |
| Language | **English** — and note exactly which one you pick |

Leave the header and buttons empty. In **Body**, put exactly this:

```
*{{1}}*

{{2}}
```

Meta demands sample values before it will submit. Give it something real:

- Sample for `{{1}}`: `Fee payment verified`
- Sample for `{{2}}`: `Your payment of Rs 25,000 has been verified. Receipt FEE-2026-000001.`

Submit. Approval is usually minutes for a Utility template, occasionally a day.

> **`en` and `en_US` are different templates to Meta.** Whichever you chose must
> match `WHATSAPP_TEMPLATE_LANGUAGE` exactly. The wrong one is refused with an
> error about the template not existing, which sends people hunting for a
> spelling mistake in the name for an hour. If you picked plain **English**, the
> code is `en`.

## Step 6 — Put the three values in `.env`

```ini
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_TEMPLATE_NAME=lms_notification
WHATSAPP_TEMPLATE_LANGUAGE=en
```

`WHATSAPP_API_VERSION` is pinned at `v21.0` and should be left alone — an
upgrade of Meta's Graph API ought to be a decision somebody makes, not something
that happens to you.

Restart the API. Under Docker, `.env` is read when a container is **created**:
`npm run docker:up`, not `restart`.

## Step 7 — Prove it actually sends

Two things are true of a recipient before WhatsApp is even attempted, and both
are easy to miss:

1. The user has a **phone number in E.164 form** — `+923001234567`, with the
   country code and no spaces. A bare `0300…` is suppressed rather than guessed
   at, because a national number sent as-is is delivered to somebody in another
   country or to nobody.
2. The user's **"this number is on WhatsApp"** flag is set. It defaults to true
   for students admitted through the application form, which asks; it defaults to
   **false** for staff accounts created by an administrator.

While you are on the test number, add your own phone to the allow-list:
**API setup → To → Manage phone number list**. A test number can only message
numbers you have nominated, and anything else comes back as error `131030`.

Then trigger a real notification — announce something to a section you are in,
or verify a fee payment — and check **Integrations → Delivery log**.

### ✅ You are done when

The Integrations screen says WhatsApp is **LIVE**, and a delivery shows **SENT**
with a message id from Meta rather than SUPPRESSED or FAILED.

## When it does not work

The adapter turns Meta's error codes into sentences, so read the delivery log
before anything else. The common ones:

| What the log says | What it means |
|---|---|
| *"No approved WhatsApp template is configured"* | `WHATSAPP_TEMPLATE_NAME` is empty. Step 5. |
| *"The access token is invalid or has expired"* (code 190) | You used the 24-hour token, or the system user token was revoked. Step 4. |
| *"Usually the template name or its language does not match"* (code 100) | Almost always `en` vs `en_US`. Step 5. |
| *"That number is not on the allow-list"* (code 131030) | You are on the test number and the recipient is not nominated. Step 7. |
| *"Outside the 24-hour reply window"* (code 131047) | Meta did not treat this as a template message. The usual cause is a template that exists but is still **Pending** rather than **Approved** — check its status in WhatsApp Manager. |
| *"That number cannot receive WhatsApp messages"* (code 131026) | Not a WhatsApp account, or the number is wrong. |
| **SUPPRESSED — "No WhatsApp number on record"** | The recipient has no phone, or the number is not marked as a WhatsApp number. Step 7. |

## What it costs

Meta charges per 24-hour **conversation**, not per message, and Utility
conversations in Pakistan are cheap — a few rupees. A student who gets four
notifications in one day is one conversation. Set a spend limit under **Business
settings → Payments** before going live on the real number; the LMS has no way
to know your balance and Meta simply stops delivering when it runs out.

## Until it is connected

Nothing is sent, and the System says so rather than pretending. Every WhatsApp
delivery is recorded **SUPPRESSED**, which is the truth. Students still receive
every notification in their in-app inbox, which is the record, and staff can read
the exact wording that would have gone out under **Integrations → Simulated
outbox** — which is also the easiest way to proofread every message the Institute
sends before a single one is real.

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
