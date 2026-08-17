# What the applicant is told, and when

The four messages an applicant receives, from the moment they press Submit to
the moment they sign in. Every line below was verified by running the flow
against the Docker stack over HTTP on **17 August 2026**, with the student
address **mhamzahabib8@gmail.com** — not by reading the code.

---

## The flow

```
   APPLICANT                     THE SYSTEM                    ADMINISTRATOR
       │                              │                              │
   fills the form                     │                              │
       ├─── Submit ──────────────────►│                              │
       │                        creates the application              │
       │                        allocates a reference                │
       │◄──── ① tracking reference ───┤                              │
       │      (email + on screen)     ├──── into the queue ─────────►│
       │                              │                              │
       │                              │              opens it, checks the slip
       │                              │                              │
       │                              │◄──── Approve ────────────────┤
       │                        registration number                  │
       │                        roll number, account,                │
       │                        enrolments — one transaction         │
       │◄──── ② sign-in details ──────┤                              │
       │      (email)                 ├── password on screen too ───►│
       │                              │                              │
   signs in, must set                 │                              │
   their own password                 │                              │
```

The other two outcomes, so nobody is left waiting:

```
       │                              │◄──── Needs more info ────────┤
       │◄──── ③ what we need ─────────┤
       │                              │◄──── Reject ─────────────────┤
       │◄──── ④ the reason, in words ─┤
```

---

## The checklist

Every line was checked by doing it, against the running stack. The evidence
column says what proved it — a response field, a database row, or a log line.

### ① When the student submits — FR-REG-018

| | What must happen | Evidence |
|---|---|---|
| ✅ | A tracking reference is generated | `REG-2026-900516` returned by `POST /public/registrations` |
| ✅ | It is emailed to the address on the form | `emailSent: true` in the response; `{"event":"admission.email","kind":"registration.received","status":"SENT"}` in the API log |
| ✅ | It is shown on screen as well | The confirmation page prints it large and selectable |
| ✅ | The page says the email was sent, and to which address | New on the confirmation page |
| ✅ | If the email could **not** be sent, the page says so and tells them to write the reference down | The alternative branch on the same page — the reference is otherwise shown nowhere else |
| ✅ | The applicant can check the status with that reference, without an account | `GET /public/registrations/REG-2026-900516/status` → `PENDING_REVIEW` |
| ✅ | A failed email cannot fail the application | The send is after the transaction commits, and its error is swallowed deliberately |
| ✅ | A **duplicate** submission emails nothing | Deliberate: the duplicate test matches on CNIC **or** email **or** phone, so a stranger typing somebody else's phone number would otherwise be sent that person's reference |

### ② When the administrator approves — FR-REG-042

| | What must happen | Evidence |
|---|---|---|
| ✅ | A registration number is issued | `CIIT/SP26-009/ISB` |
| ✅ | A roll number is issued | `9` |
| ✅ | A student account is created | Row in `students`, joined to a `users` row with that email |
| ✅ | They are enrolled in the class's subjects | 2 rows in `enrolments` |
| ✅ | A temporary password is emailed to them | `notificationsSent: ["Sign-in details emailed to mhamzahabib8@gmail.com."]`; log line `kind:"registration.approved", status:"SENT"` |
| ✅ | The email carries everything needed to sign in | Address, email, password, registration number — asserted in `admission-mailer.spec.ts` |
| ✅ | The password still appears on the administrator's screen | Delivery is never certain; the office must be able to read it out |
| ✅ | The student can sign in with the emailed password | `POST /auth/login` → 200 |
| ✅ | They are forced to change it immediately | `mustChangePassword: true`, from the API and the database |
| ✅ | The administrator is told whether the email actually left | `notificationsSent` is now rendered on the receipt; a failure says **"Send the password above to the student yourself"** |
| ✅ | A **returning** student gets no credentials email | Their account was not touched. The receipt shows the note instead of an empty password box |
| ✅ | The password is never written to a log, an inbox row, or the audit log | Asserted by a test that fails if the body is added to the log line |

### ③ When more information is needed — FR-REG-035

| | What must happen | Evidence |
|---|---|---|
| ✅ | The applicant is emailed what is missing | `sendInfoRequest`, wired into `requestInfo()` |
| ✅ | The message repeats the reference | It is what the office asks for when they reply |
| ✅ | It says nothing already sent has been lost | Otherwise people re-apply from scratch, which creates the duplicate the office then has to reconcile |

### ④ When an application is rejected — FR-REG-033/034/046

| | What must happen | Evidence |
|---|---|---|
| ✅ | The applicant is told | `["The applicant was emailed at mhamzahabib8@gmail.com."]`; log line `kind:"registration.rejected", status:"SENT"` |
| ✅ | The reason is in plain words, not a code | `SLIP_ILLEGIBLE` becomes *"We could not read the payment slip you sent. A clearer photograph… is all we need"*. A test fails if the raw code appears in the body |
| ✅ | Fixable reasons say so and invite a new application | Payment not found, amount short, slip unreadable, class full — all fixable the same day |
| ✅ | The reviewer's own note is included when they wrote one | |
| ✅ | Everything they sent is kept (BR-REG-11) | Stated in the message, and true in the database |

### What the email itself must not do

| | | |
|---|---|---|
| ✅ | The password appears **only** in the message body | Not in the audit log, not in a notification row, not in the service's log line |
| ✅ | Neither email is stored anywhere it outlives its use | These go straight through the mail adapter rather than the notification service, which would write an inbox row holding the password for years |
| ✅ | A suppressed send is reported as **not sent** | An unconfigured mail server does not throw — it returns `SUPPRESSED`, which reads as success. Reporting that as sent is how a student never gets a password and the office is told they did |
| ✅ | A mail server that is down cannot roll back an approval | The send is outside the transaction and its failure is caught |

---

## Two faults this found

Both were invisible from inside the code, and both would have hit the
Institute on their first day of real use.

**Email was never configured inside Docker.** `docker-compose.yml` passed no
mail settings to the API container at all. Compose reads `.env` to interpolate
*itself*; it does not hand those variables to a service unless the service
names them. So the credentials in `.env` worked from the host — the check
script passed, a test message arrived — and the same code in the container had
no mail server, reported itself correctly as unconfigured, and silently
suppressed every message. Fixed by naming them in the compose file, along with
`PUBLIC_WEB_URL`: the code's fallback is the development port, so students
would have been emailed a link to a port serving nothing.

**The first admission on a seeded database was refused.** The seed writes eight
students with their registration numbers spelled out and never advanced the
counter, so the first real approval was allocated `CIIT/SP26-001/ISB` — already
in use — and came back as `409 DUPLICATE_RESOURCE: unique constraint on
["registration_no"]`, on the System's most consequential transaction, naming
nothing an administrator could act on. This is the same disagreement OPN-01
describes on the Institute's real data: numbers issued by hand for years, and a
new deployment starting at 1. Now the allocator checks that the number it was
handed is genuinely free and steps over any that are not, still in one atomic
statement per attempt so concurrent approvals cannot collide (RSK-07). It heals
itself: it walked past eight, the counter is now 9, and it will not walk again.

---

## Running it yourself

```powershell
npm run docker:up                          # build and recreate — then http://localhost:8080
```

The credentials must be in `.env` **before** that command, because compose
reads them at container-creation time:

```ini
MAIL_DRIVER=smtp
MAIL_FROM="Prepreneurship <you@gmail.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-16-character-app-password
```

Check they arrived:

```powershell
docker compose exec api sh -c 'echo $SMTP_HOST $SMTP_USER'
```

An empty answer means the container has no mail settings, whatever `.env`
says — recreate the containers rather than restarting them.

Then apply at <http://localhost:8080/apply>, and approve from **Admissions**
signed in as `admin@institute.local`.
