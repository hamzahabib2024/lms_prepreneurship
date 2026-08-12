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

if (clearing) {
  const res = await fetch(`${BASE}/settings/${KEY}`, { method: "DELETE", headers: auth });
  console.log(
    res.ok
      ? `\nRemoved the demo videos. The section disappears rather than showing an empty shelf.\n`
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
  if (!res.ok) {
    console.error(`\n  The API refused the value (${res.status}).`);
    console.error(`  ${(await res.text()).slice(0, 300)}\n`);
    process.exit(1);
  }

  console.log(`\n  Added ${DEMO.length} videos to the public page:\n`);
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
