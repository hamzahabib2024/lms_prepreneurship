# Connecting the outside world

Four things the System talks to. **None of them is required to run it** — every
one has a working fallback, and the Integrations screen (in the sidebar, under
Institute) says at any moment which are live and which are not.

Set them in `.env` at the repository root. Restart the API after any change;
none of these is read again while it is running.

| | What it does | Needed from | Without it |
|---|---|---|---|
| **Email (SMTP)** | Passwords, receipts, every notification | Any mailbox you already own | Nothing is emailed |
| **Google Drive** | Lecture video storage | A Google Cloud service account | Video served from the app server |
| **Google Meet** | Automatic class links | The same service account | Links pasted in by hand |
| **WhatsApp** | Messages to students | Meta Business account | Nothing is sent; in-app inbox still works |

Start with email. It is the one that needs nothing from anybody else, and it is
the one currently costing you the most.

---

## 1. Email — do this first

### Why it matters more than it looks

When an administrator creates an account, the System generates a temporary
password and **shows it once on screen**. There is no second chance to see it.
Today the only way it reaches the person is the administrator reading it out or
copying it into a chat — which means the password to a student record ends up
sitting in someone's WhatsApp history for good.

With email configured, the System sends it directly.

### Using Gmail

You need a **Google Account** and, on it, an **App Password** — a 16-character
code that lets one program send mail without ever holding your real password.

1. The account must have **2-Step Verification** switched on. Google will not
   offer App Passwords otherwise.
   → <https://myaccount.google.com/signinoptions/two-step-verification>

2. Go to **App passwords**, name it something like `Prepreneurship LMS`, and
   create it.
   → <https://myaccount.google.com/apppasswords>

3. Google shows a 16-character code such as `abcd efgh ijkl mnop`. **Copy it
   now** — it is shown once. The spaces do not matter.

4. Put it in `.env`:

```ini
MAIL_DRIVER=smtp
MAIL_FROM="Prepreneurship <office@prepreneurship.pk>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=office@prepreneurship.pk
SMTP_PASSWORD=abcdefghijklmnop

# Used to turn "/subjects" into a link somebody can click
PUBLIC_WEB_URL=https://learn.prepreneurship.pk
INSTITUTE_NAME=Prepreneurship
```

5. Restart the API. The Integrations screen should now show **Email — live**.

> **`MAIL_DRIVER=log` overrides all of the above.** It is the default, and it
> means nothing is sent even when the credentials are correct — the wording goes
> to the simulator outbox instead. Keep it that way on any machine holding a
> copy of real student data. You will not be caught out silently: the
> Integrations screen names `MAIL_DRIVER` as the reason rather than telling you
> email is unconfigured.

### Two things worth knowing before you commit to Gmail

**A free Gmail account sends about 500 messages a day; Google Workspace about
2,000.** A cohort announcement to 300 students is 300 messages. If the Institute
grows past that, move to a service built for it — Amazon SES, Postmark,
Mailgun — which is a change of four lines above and nothing else. Nothing in the
code names Gmail.

**Mail from a `@gmail.com` address is more likely to land in spam** when it
claims to be from an institute. If Prepreneurship owns a domain, send from that
domain and add SPF and DKIM records for it. Your domain registrar or Workspace
admin can do this in about ten minutes, and it is the difference between fee
reminders arriving and quietly not arriving.

### Checking it actually works

Post an announcement to a section, then open **Integrations → Simulated
outbox**. If email is configured, the message will not appear there — it will
have gone. If it does appear, email is still off and the screen will say so.

---

## 2. Google Drive — lecture video

Drive is where the Institute's lecture recordings live. The System **catalogues
and streams** them; it never uploads to Drive, and never deletes from it.
Teachers upload through Drive itself, exactly as they do now.

### What you need

A **service account** — a Google identity that belongs to the organisation
rather than to a person, so access does not disappear when a staff member
leaves.

1. Go to the **Google Cloud Console** → <https://console.cloud.google.com>
2. Create a project (or pick an existing one). Call it `prepreneurship-lms`.
3. **APIs & Services → Library** → enable **Google Drive API**.
   Enable **Google Calendar API** at the same time — Meet links need it, and
   doing both now saves a second pass.
4. **IAM & Admin → Service Accounts → Create service account.**
   Name: `lms-drive`. No roles are needed at the project level.
5. Open the account → **Keys → Add key → Create new key → JSON.** A file
   downloads. **This file is the credential.** Anyone holding it can read
   whatever the account can read.
6. In Drive, find the folder holding lecture recordings, **Share** it with the
   service account's email address (it looks like
   `lms-drive@prepreneurship-lms.iam.gserviceaccount.com`), as **Viewer**.

Viewer, not Editor. The System only ever reads.

7. In `.env`:

```ini
GOOGLE_SERVICE_ACCOUNT_JSON=/etc/prepreneurship/service-account.json
LECTURE_STORAGE=google_drive
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbC...    # the folder's id, from its URL
```

Keep the JSON file **outside the repository** and readable only by the account
the server runs as. It is not a password that can be changed if it leaks — it is
a key, and the only remedy is deleting it in the Console and issuing another.

### Until then

`LECTURE_STORAGE=local` (the default) serves video from the application server.
Cataloguing, publication, playback and the weekly integrity check all work
normally. The only difference is where the file sits.

---

## 3. Google Meet — class links

Same service account, same JSON file. Once `GOOGLE_SERVICE_ACCOUNT_JSON` is set
and the Calendar API is enabled, scheduling a class creates the meeting link
automatically.

**Domain-wide delegation.** A service account cannot create a meeting "as"
anybody by default. In Google Workspace admin → **Security → API controls →
Domain-wide delegation**, add the service account's client ID with the scope:

```
https://www.googleapis.com/auth/calendar.events
```

Without this the System will report the classroom provider as unavailable
rather than creating broken links.

### Until then

Whoever schedules the class pastes the Meet link into the session. Attendance,
the register, the timetable and the attendance rules all work exactly the same —
only the link is manual.

---

## 4. WhatsApp — messages to students

The heaviest of the four, and the only one that needs a business relationship
with a third party.

1. A **Meta Business account** → <https://business.facebook.com>
2. In **Meta for Developers**, create an app of type **Business**, and add the
   **WhatsApp** product.
3. Register a phone number for it. **The number cannot already be in use by the
   normal WhatsApp or WhatsApp Business app** — this catches most people. Use a
   dedicated line.
4. Note the **Phone number ID** and generate a **permanent access token** (a
   System User token, not the 24-hour test token, which expires and produces a
   failure the next morning that looks like an outage).
5. In `.env`:

```ini
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
```

**Message templates.** Meta requires pre-approved templates for anything sent
outside a 24-hour window of the student writing to you — which is essentially
every message this System sends. Submit templates matching the wording on the
**Message wording** screen and wait for approval, typically a day or two.

### Until then

Nothing is sent, and the System says so rather than pretending. Students still
receive every notification in their in-app inbox, which is the record. Staff can
read the exact wording that would have gone out under **Integrations →
Simulated outbox**, which is also the easiest way to proofread the messages
before a single one is real.

---

## Keeping the credentials safe

`.env` is in `.gitignore` and must stay there. If a credential is ever committed,
pushed, or pasted into a chat, treat it as public and replace it:

- **App Password** — delete it at <https://myaccount.google.com/apppasswords>
  and make a new one.
- **Service account key** — delete the key in the Cloud Console. The account
  survives; only the key changes.
- **WhatsApp token** — revoke the System User token in Meta Business settings.

Rotating any of them is a `.env` edit and a restart. Nothing else in the System
needs to change, which is the point of keeping every provider behind an adapter.

The System will never show you a credential back, on any screen, to anybody —
including a Super Admin. It reports only whether something is set. That is
deliberate: a value that can be read can be leaked, and there is no reason for
the interface to be able to read it.
