/**
 * Fills the public page's video wall with borrowed videos, so it can be SEEN.
 *
 *   node -r dotenv/config scripts/demo-videos.mjs         # set them
 *   node -r dotenv/config scripts/demo-videos.mjs --clear # take them away
 *
 * THESE ARE NOT PREPRENEURSHIP'S VIDEOS. They belong to the channels named
 * below and are here only so the wall is not an empty shelf while the real
 * ones are being decided. The section they appear under says "straight from
 * our own channels", which is true of the Institute's links and a lie about
 * these — so this writes to the database rather than to the page, it prints a
 * warning every time, and --clear puts it back.
 *
 * Every id was checked against YouTube's oEmbed endpoint before being written
 * here, so each one exists and the title beside it is the real one. Guessing
 * ids would put unknown content on an institute's front page.
 */
/*
 * IT GOES THROUGH THE API, NOT THE DATABASE.
 *
 * Settings are cached per process and the cache is cleared on write THROUGH
 * the service. Writing the row directly leaves a running server serving its
 * old copy, so the page stays empty and the obvious conclusion is that the
 * feature is broken. Going through the endpoint also validates the value and
 * records who changed it, which is what the real screen does.
 */
const BASE = process.env["API_URL"] ?? "http://localhost:3000/api/v1";
const KEY = "public.videoUrls";

/** Verified 13 August 2026. Teaching material and one Blender short. */
const DEMO = [
  ["https://www.youtube.com/watch?v=_uQrJ0TkZlc", "Python Full Course for Beginners — Programming with Mosh"],
  ["https://www.youtube.com/watch?v=hdI2bqOjy3c", "JavaScript Crash Course For Beginners — Traversy Media"],
  ["https://www.youtube.com/watch?v=Ke90Tje7VS0", "React JS Tutorial for Beginners — Programming with Mosh"],
  ["https://www.youtube.com/watch?v=rfscVS0vtbw", "Learn Python — freeCodeCamp.org"],
  ["https://www.youtube.com/watch?v=aircAruvnKk", "But what is a neural network? — 3Blue1Brown"],
  ["https://www.youtube.com/watch?v=YE7VzlLtp-4", "Big Buck Bunny — Blender"],
];

const clearing = process.argv.includes("--clear");

async function signIn() {
  const email = process.env["SUPERADMIN_EMAIL"] ?? "superadmin@institute.local";
  const password = process.env["SUPERADMIN_PASSWORD"] ?? "ChangeMe!SuperAdmin2026";
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);

  if (!res) {
    console.error(`\n  Could not reach the API at ${BASE}.`);
    console.error(`  Start it first:  npm run dev\n`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\n  Could not sign in as ${email} (${res.status}).`);
    console.error(`  Settings are Super Admin only. Set SUPERADMIN_EMAIL and`);
    console.error(`  SUPERADMIN_PASSWORD if yours differ from the seeded ones.\n`);
    process.exit(1);
  }
  const body = await res.json();
  return body.data.accessToken ?? body.data.tokens?.accessToken;
}

const token = await signIn();
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

/**
 * Two public notices, so the news strip is not an empty promise either.
 *
 * These are written as an institute would write them and are true of nothing —
 * they are removed by --clear along with the videos.
 */
/**
 * Photographs for the carousel — placeholders, and obviously so.
 *
 * picsum.photos returns a real random photograph for a given seed, which is
 * exactly the stock imagery the public page's own notes argue against: a
 * visitor recognises it and stops believing everything else on the page. They
 * are here so the carousel can be SEEN working, and the warning below says to
 * replace them, in the same breath as the videos.
 *
 * Every URL was checked before being written down: 200, image/jpeg, and
 * accepted by parseImageLinks — which refuses http and anything without an
 * image extension, so a link that merely looks right would be dropped
 * silently and the carousel would stay empty for no visible reason.
 */
const IMAGE_KEY = "public.imageUrls";
const IMAGES = [
  "https://picsum.photos/seed/prep-classroom/1400/700.jpg | A morning design class",
  "https://picsum.photos/seed/prep-studio/1400/700.jpg | The studio, mid-project",
  "https://picsum.photos/seed/prep-graduation/1400/700.jpg | Graduation, Spring 2026",
  "https://picsum.photos/seed/prep-lab/1400/700.jpg | The computer lab",
];

const NEWS = [
  {
    title: "Applications open for the Spring intake",
    body:
      "Applications for Graphic Designing and Digital Marketing are open. Apply online with " +
      "your CNIC and a payment slip — no account needed, and you will get a tracking reference " +
      "you can check at any time.",
  },
  {
    title: "Evening sections added for working students",
    body:
      "We have opened evening sections on both diplomas after a term of asking. Same syllabus, " +
      "same certificate, taught between six and nine.",
  },
];

if (clearing) {
  const res = await fetch(`${BASE}/settings/${KEY}`, { method: "DELETE", headers: auth });
  await fetch(`${BASE}/settings/${IMAGE_KEY}`, { method: "DELETE", headers: auth });

  // The notices too, or --clear would leave half the demo standing.
  const list = await fetch(`${BASE}/announcements`, { headers: auth })
    .then((r) => r.json())
    .catch(() => null);
  let withdrawn = 0;
  for (const a of list?.data ?? []) {
    if (NEWS.some((n) => n.title === a.title)) {
      const r = await fetch(`${BASE}/announcements/${a.id}/withdraw`, { method: "POST", headers: auth });
      if (r.ok) withdrawn++;
    }
  }

  console.log(
    res.ok
      ? `\nRemoved the demo videos and ${withdrawn} demo notice(s). The sections disappear rather than showing an empty shelf.\n`
      : `\nCould not remove them (${res.status}).\n`,
  );
  process.exit(res.ok ? 0 : 1);
} else {
  const value = DEMO.map(([url]) => url);
  const res = await fetch(`${BASE}/settings/${KEY}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ value }),
  });
  await fetch(`${BASE}/settings/${IMAGE_KEY}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ value: IMAGES }),
  });
  if (!res.ok) {
    console.error(`\n  The API refused the value (${res.status}).`);
    console.error(`  ${(await res.text()).slice(0, 300)}\n`);
    process.exit(1);
  }

  // Posted rather than written to the table, so they go through the same
  // validation and audit as a real notice — and so a sectional one would be
  // refused here exactly as it is on the screen.
  const existing = await fetch(`${BASE}/announcements`, { headers: auth })
    .then((r) => r.json())
    .catch(() => null);
  const already = new Set((existing?.data ?? []).map((a) => a.title));
  let posted = 0;
  for (const n of NEWS) {
    if (already.has(n.title)) continue;
    const r = await fetch(`${BASE}/announcements`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ audience: "INSTITUTE", isPublic: true, ...n }),
    });
    if (r.ok) posted++;
  }

  console.log(`\n  Added ${DEMO.length} videos, ${IMAGES.length} photographs and ${posted} public notice(s):\n`);
  for (const [, title] of DEMO) console.log(`    · ${title}`);
  console.log(`
  ⚠  THESE ARE NOT YOURS. They belong to the channels above and are on the
     page only so the wall can be seen working. Replace them before anybody
     outside the Institute looks at this:

       Settings → Public page → public.videoUrls

     or remove them with:

       node scripts/demo-videos.mjs --clear
`);
}
