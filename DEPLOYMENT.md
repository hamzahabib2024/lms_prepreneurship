# Deploying the Prepreneurship LMS

**Written for somebody who has never deployed anything.** Every command is one
you can copy. Where a step can go wrong, it says so and says what the failure
looks like — because the failures here do not announce themselves, they arrive
three weeks later as "a student says her certificate is missing".

Read the whole of **Part 1** before you start. It is short, and it decides
things that are painful to change later.

---

## Part 1 — Decide these three things first

### 1.1 One server, or several?

**Use one.** Not as a compromise — it is what this System is built for today.

Running two copies behind a load balancer **loses files on the first day**.
Uploads are written to the disk of whichever copy handled them, and the other
copy cannot read them. The database row survives and points at a file that is
not there, so it looks like the Institute lost a student's evidence rather than
like a configuration mistake.

One server handles a few hundred students comfortably. When you genuinely
outgrow it, move file storage to S3 or Cloudflare R2 **first**, then add the
second server. Not the other way round.

### 1.2 How big a server?

| Students | CPU | RAM | Disk |
|---|---|---|---|
| Up to 300 | 2 cores | 4 GB | 40 GB |
| 300–1,500 | 4 cores | 8 GB | 100 GB |

Disk is what runs out. Uploads live on it and never shrink by themselves.
Watch it — §7.3.

Any provider is fine: DigitalOcean, Hetzner, Linode, AWS Lightsail, or a
machine in the Institute's own office. **Ubuntu 22.04 or 24.04** is assumed
below.

### 1.3 A domain name

You need one — say `lms.prepreneurship.com` — pointed at the server's IP
address. Not optional: without HTTPS, every password typed by every student
travels the network in the clear, and browsers will refuse features the System
uses.

Set an **A record** for your domain to the server's IP with your domain
registrar. It takes a few minutes to an hour to take effect.

---

## Part 2 — Prepare the server

Everything from here runs **on the server**, over SSH.

```bash
ssh root@YOUR-SERVER-IP
```

### 2.1 Bring it up to date and add a user

Working as `root` all the time is how a single mistyped command becomes
unrecoverable.

```bash
apt update && apt upgrade -y
adduser lms                 # choose a password when prompted
usermod -aG sudo lms
```

Now log in as that user and stay there:

```bash
su - lms
```

### 2.2 Install Docker

Docker runs the System in containers, so you do not install Node, PostgreSQL
or anything else by hand.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

**Log out and back in** — the group change does not apply to your current
session. Then check:

```bash
docker --version && docker compose version
```

Both should print a version. If `docker compose` says "not a docker command",
your Docker is too old; reinstall with the command above.

### 2.3 Get the code

```bash
cd ~
git clone YOUR-REPOSITORY-URL lms
cd lms
```

If the repository is private, GitHub will ask for a username and a **personal
access token** — not your password. Create one at
GitHub → Settings → Developer settings → Personal access tokens.

---

## Part 3 — Configuration

This is the part that repays care. Everything the System needs to know that is
not in the code lives in one file called `.env`.

```bash
cp .env.example .env
nano .env
```

`nano` is a text editor. Arrow keys move, `Ctrl+O` then `Enter` saves,
`Ctrl+X` exits.

### 3.1 The settings you must change

```ini
NODE_ENV=production
PORT=3000

# YOUR domain, with https. Used in password-reset emails and certificate
# verification links. Get this wrong and the reset link in every email points
# somewhere that does not exist.
APP_URL=https://lms.prepreneurship.com
PUBLIC_WEB_URL=https://lms.prepreneurship.com
WEB_ORIGIN=https://lms.prepreneurship.com

# The database password. Invent a long one — you will not type it again.
POSTGRES_PASSWORD=a-long-random-password-you-invent

# You will be behind nginx (Part 5), which counts as one proxy.
TRUST_PROXY_HOPS=1

INSTITUTE_NAME=Prepreneurship Institute
```

> **`TRUST_PROXY_HOPS` is the one people skip.** Without it every request
> appears to come from nginx rather than from a person. The rate limiter then
> treats **the whole Institute as a single visitor and locks everybody out at
> once**, and the audit log records nginx's address instead of the student's.
> One line. Do not skip it.

### 3.2 Email — needed for forgotten passwords

Without this, "I have forgotten my password" cannot work.

Any provider that speaks SMTP will do. With Gmail you must create an **App
Password** (Google Account → Security → 2-Step Verification → App passwords) —
your ordinary Gmail password will not work.

```ini
MAIL_DRIVER=smtp
MAIL_FROM=Prepreneurship <no-reply@prepreneurship.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=the-16-character-app-password
```

Leave `MAIL_DRIVER=log` while you are testing: nothing is sent, and the wording
is written to a simulator you can read in the app under **Integrations**. That
is the safe way to proofread the messages before real students receive them.

### 3.3 Google Drive — optional, for class recordings

Only needed if teachers keep recordings in Drive.

```ini
GOOGLE_CREDENTIALS_DIR=/home/lms/lms/credentials
GOOGLE_SERVICE_ACCOUNT_FILE=your-service-account.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=the-folder-id-from-the-Drive-URL
```

Put the service-account JSON file in `~/lms/credentials/` and share the Drive
folder with the `client_email` address inside that file.

> **Read this before planning anything around Drive.** A service account has
> **no storage of its own**. It can *read* folders and *create* folders, but
> uploading a file is refused with `storageQuotaExceeded` — including from the
> LMS's own "upload a recording" button.
>
> Two ways round it, and both need real Google **Workspace**, not a personal
> Gmail:
>
> - put the folders in a **Shared Drive**, where storage belongs to the
>   organisation; or
> - set `GOOGLE_IMPERSONATE_SUBJECT` to a Workspace user's address, so the LMS
>   acts as that person and files are owned by them.
>
> On a personal Gmail, treat Drive as a **read-only source of recordings**.
> That works well and needs nothing further.

### 3.4 WhatsApp — optional

```ini
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_NAME=
```

Leave blank and nothing is sent. The System will not pretend otherwise: it
records each message as suppressed and writes it to the simulator.

### 3.5 Generate the signing keys

These sign the tokens that keep people logged in.

```bash
npm run keys:generate
```

Creates `keys/jwt-private.pem` and `keys/jwt-public.pem`.

> **Never commit these, never email them, never reuse them between
> installations.** Anybody holding the private key can mint a token for any
> account, including a super administrator. If one leaks, generate new ones —
> everybody is signed out, which is the point.

---

## Part 4 — Start it

```bash
cd ~/lms
npm run docker:up
```

First run takes several minutes: it builds the application, starts PostgreSQL,
applies every database migration and creates the tables.

Check all three are running:

```bash
docker compose ps
```

You want `postgres`, `api` and `web` all showing **healthy** or **running**. If
`api` says `unhealthy`, wait a minute — it waits for the database — then look
at §7.1.

### 4.1 Create the first administrator

The database starts empty. Seed it:

```bash
npm run db:seed
```

This prints the accounts it created and their passwords.

> **Sign in as the super administrator and change that password immediately.**
> It is printed on a screen, it is in your terminal history, and it is the same
> on every installation of this System in the world.

### 4.2 Check it answers

```bash
curl http://localhost:3000/api/v1/system/health
```

You want `"database":{"status":"up"}`. Redis and object storage reporting *not
configured* is **correct and expected** — they are optional.

---

## Part 5 — Put it on the internet, with HTTPS

Right now the System answers only on the server itself. nginx sits in front,
handles HTTPS, and passes requests through.

### 5.1 Install nginx and Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 5.2 Configure the site

```bash
sudo nano /etc/nginx/sites-available/lms
```

Paste this, replacing the domain:

```nginx
server {
    listen 80;
    server_name lms.prepreneurship.com;

    # Uploads: a phone video for an assignment is easily 40 MB, and nginx's
    # default ceiling is 1 MB. Without this, large submissions fail with a
    # bare 413 that mentions nothing about size.
    client_max_body_size 200M;

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host              $host;
        # These two are what TRUST_PROXY_HOPS reads. Without them the rate
        # limiter sees every request as coming from nginx.
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A big upload on a slow connection takes longer than the default 60s.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
    }
}
```

Enable it and restart:

```bash
sudo ln -s /etc/nginx/sites-available/lms /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # must say "syntax is ok"
sudo systemctl restart nginx
```

### 5.3 Turn on HTTPS

```bash
sudo certbot --nginx -d lms.prepreneurship.com
```

Answer the prompts and choose **redirect HTTP to HTTPS**. Certbot renews the
certificate automatically from now on.

Open `https://lms.prepreneurship.com` in a browser. You should see the sign-in
page with a padlock.

### 5.4 Close everything else

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

This shuts the door on ports 3000, 8080 and 5432 from the outside. They are
still reachable from nginx on the server itself, which is all they need.

---

## Part 6 — Backups

**Do this before you let real students in.** Everything above makes the System
run. This is what stops it losing everything.

### 6.1 What has to be saved

Two things, and **both** or neither:

| | Where | Why |
|---|---|---|
| The database | Docker volume `postgres-data` | Every record: marks, attendance, fees |
| The files | Docker volume `api-storage` | Submissions, fee slips, signatures |

> The System has a built-in backup under **Settings → Backup**. Use it — but
> know what it is. It is a **data** backup: rows only. It does not save the
> database structure, and **it does not save uploaded files at all**. Restore
> from it alone and every submission is a broken link. It is a useful second
> copy, not your backup.

### 6.2 A nightly backup that covers both

```bash
sudo nano /home/lms/backup-lms.sh
```

```bash
#!/bin/bash
# Nightly backup of the LMS: the database AND the uploaded files.
# Either one alone is useless — the rows point at the files.
set -euo pipefail

STAMP=$(date +%F-%H%M)
OUT=/home/lms/backups
mkdir -p "$OUT"

cd /home/lms/lms

# The database, as a real pg_dump from inside the container.
docker compose exec -T postgres pg_dump -U lms lms | gzip > "$OUT/db-$STAMP.sql.gz"

# The uploaded files, out of the Docker volume.
#
# The volume name is PREFIXED with the project directory, so it is
# `lms_prepreneurship_api-storage` if you cloned into `lms_prepreneurship`.
# Asking Docker rather than hard-coding it keeps this working if the
# directory is ever renamed - and a wrong name here does NOT fail loudly,
# it silently backs up an empty volume.
VOLUME=$(docker volume ls --format '{{.Name}}' | grep 'api-storage$' | head -1)
if [ -z "$VOLUME" ]; then
  echo "ERROR: no api-storage volume found. Is the stack running?" >&2
  exit 1
fi

docker run --rm \
  -v "$VOLUME":/data:ro \
  -v "$OUT":/backup \
  alpine tar czf "/backup/files-$STAMP.tar.gz" -C /data .

# Keep 14 days. Without this the disk fills and the System stops.
find "$OUT" -name '*.gz' -mtime +14 -delete

echo "$(date -Iseconds) backup ok: db-$STAMP.sql.gz files-$STAMP.tar.gz"
```

```bash
chmod +x /home/lms/backup-lms.sh
/home/lms/backup-lms.sh          # run it once now
ls -lh /home/lms/backups         # check both files exist and are not 0 bytes

# And that the files archive really holds the uploads. An archive of an
# empty volume is about 45 bytes and looks perfectly fine in a listing.
tar tzf /home/lms/backups/files-*.tar.gz | head
```

Schedule it for 2am:

```bash
crontab -e
```

```
0 2 * * * /home/lms/backup-lms.sh >> /home/lms/backup.log 2>&1
```

### 6.3 Get a copy OFF the server

**A backup on the same disk as the thing it is backing up is not a backup.**
The disk that fails takes both.

Copy to another machine nightly — from your office computer, not the server:

```bash
rsync -avz lms@YOUR-SERVER-IP:/home/lms/backups/ ~/lms-backups/
```

Or push to any cloud storage with [rclone](https://rclone.org). Anywhere that
is not this server.

### 6.4 Practise a restore — once, on purpose

A backup nobody has restored is a hope. Do this once, on a spare machine, while
nothing is wrong:

```bash
gunzip < db-2026-08-27-0200.sql.gz | docker compose exec -T postgres psql -U lms lms
VOLUME=$(docker volume ls --format '{{.Name}}' | grep 'api-storage$' | head -1)
docker run --rm -v "$VOLUME":/data -v /home/lms/backups:/backup \
  alpine tar xzf /backup/files-2026-08-27-0200.tar.gz -C /data
```

If that works, you have a backup. If you have never tried it, you have files.

---

## Part 7 — Running it

### 7.1 Everyday commands

```bash
cd ~/lms

docker compose ps                    # what is running
docker compose logs -f api           # watch the API (Ctrl+C to stop watching)
docker compose logs --tail=100 api   # the last hundred lines
docker compose restart api           # restart just the API
npm run docker:down                  # stop everything
npm run docker:up                    # start everything
```

### 7.2 Updating to a new version

```bash
cd ~/lms
/home/lms/backup-lms.sh      # ALWAYS back up before updating
git pull
npm run docker:up            # rebuilds and applies new migrations
```

Database migrations run automatically on start. If the API will not come up
after an update, the logs (§7.1) name the migration that failed.

### 7.3 Watch the disk

The one thing that fills quietly.

```bash
df -h /                                  # overall
docker system df                         # what Docker is using
du -sh ~/backups                         # backups are usually the culprit
```

At 80%, either raise the disk or shorten the backup retention in §6.2.

### 7.4 Watch for trouble

```bash
docker compose logs api | grep -i error | tail -20
curl -s localhost:3000/api/v1/system/health
```

---

## Part 8 — Before you announce it

Work down this list. Every item is something that has gone wrong for somebody.

- [ ] `https://` works and the padlock shows
- [ ] `http://` redirects to `https://`
- [ ] Signed in as super administrator and **changed the seeded password**
- [ ] `TRUST_PROXY_HOPS=1` is set *(otherwise one busy morning locks everybody out)*
- [ ] `APP_URL` is your real domain *(otherwise password-reset links point at localhost)*
- [ ] Sent yourself a password reset and the email arrived with a working link
- [ ] Uploaded a file as a student and downloaded it back as a teacher
- [ ] Issued a certificate and opened its verification link signed out
- [ ] `backup-lms.sh` has run and produced **two** files, neither empty
- [ ] A backup has been copied **off** the server
- [ ] A restore has been rehearsed at least once
- [ ] The firewall is on (`sudo ufw status` says active)
- [ ] Only **one** copy of the API is running

---

## Part 9 — When something is wrong

**The site does not load at all.**
`docker compose ps` — is `web` running? Then `sudo systemctl status nginx`.
Then `sudo ufw status`. It is almost always one of those three.

**"502 Bad Gateway".**
nginx is up and the API is not. `docker compose logs --tail=50 api`.

**Nobody can sign in, everybody at once.**
The rate limiter is treating everyone as one visitor. `TRUST_PROXY_HOPS=1` is
missing, or nginx is not sending `X-Forwarded-For` (§5.2). Fix, then
`docker compose restart api`.

**Password-reset emails do not arrive.**
Check spam. Then `docker compose logs api | grep -i mail`. With Gmail, confirm
you used an **App Password**, not the account password. Confirm `MAIL_DRIVER`
is `smtp` and not `log`.

**A reset link points at `localhost`.**
`APP_URL` is unset or wrong. Fix and restart.

**A file cannot be downloaded although the record exists.**
Somebody is running two copies of the API — §1.1. Or `api-storage` was not
restored alongside the database.

**Recordings will not upload to Drive.**
Expected on a personal Gmail — §3.3. Not a fault to debug.

**The disk is full.**
§7.3. Usually backups.

---

## Part 10 — What this System does not do yet

Stated plainly so nobody discovers it during an emergency.

- **It runs on one node.** Files are on local disk and permission caches are
  per-process. Two nodes lose files and let a revoked role keep working for up
  to a minute.
- **The built-in backup does not include uploaded files or the schema.** Part 6
  is the real backup.
- **A service account cannot upload to a personal Google Drive.** Read and
  folder creation work; uploads do not.
- **There is no automatic off-site backup.** §6.3 is manual until you set up
  rclone or rsync.

---

*Keep this file with the System. When something goes wrong at 9am on a Monday,
this is what the person on duty will be reading.*
