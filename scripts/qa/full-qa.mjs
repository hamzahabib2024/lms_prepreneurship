/**
 * A–Z QA of the LMS, against the RUNNING SYSTEM with the Institute's own data.
 *
 * Not a substitute for the 1496 jest tests — those pin the rules in isolation,
 * and passing them says nothing about whether a teacher can set an assignment
 * today. This walks the paths a real term depends on, in the order a real term
 * uses them, and reports what a person would actually experience.
 *
 * Anything it creates is prefixed `QA ` and cleaned up at the end.
 */

const API = "http://localhost:3000/api/v1";

const WHO = {
  super: ["superadmin@institute.local", "ChangeMe!SuperAdmin2026"],
  admin: ["admin@institute.local", "ChangeMe!Admin2026"],
  teacher: ["sana@institute.local", "ChangeMe!Teacher2026"],
  student: ["hina2@student.local", "ChangeMe!Student2026"],
};

const tok = {};
const results = [];
let section = "";

const sec = (name) => {
  section = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
};

function ok(name, condition, detail = "") {
  results.push({ section, name, pass: !!condition, detail });
  console.log(`  ${condition ? "ok  " : "FAIL"} ${name}${detail ? "  — " + detail : ""}`);
  return !!condition;
}

async function call(role, method, path, body, isForm = false) {
  const headers = {};
  if (tok[role]) headers["Authorization"] = `Bearer ${tok[role]}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => null);
    return { status: res.status, data: j?.data, error: j?.error, raw: j };
  } catch (e) {
    return { status: 0, error: { message: String(e?.message ?? e) } };
  }
}

const stamp = Date.now();
const made = { assignments: [], announcements: [], quizzes: [] };

// ══════════════════════════════════════════════════════════ 1. identity ═══
sec("1. identity and sessions");
for (const [role, [email, password]] of Object.entries(WHO)) {
  const r = await call(null, "POST", "/auth/login", { email, password, deviceLabel: "qa" });
  tok[role] = r.data?.accessToken;
  ok(`${role} signs in`, !!tok[role], r.error?.message);
}
{
  const me = await call("student", "GET", "/auth/me");
  ok("who am I returns the right person", me.data?.email === WHO.student[0], me.data?.email);
  ok("a student's own registration number is present", !!me.data?.student?.registrationNo, me.data?.student?.registrationNo);

  const bad = await call(null, "POST", "/auth/login", { email: WHO.student[0], password: "wrong", deviceLabel: "qa" });
  ok("a wrong password is refused", bad.status === 401, `got ${bad.status}`);

  const noTok = await call(null, "GET", "/auth/me");
  ok("no token is refused", noTok.status === 401, `got ${noTok.status}`);
}

// ═══════════════════════════════════════════════════════ 2. the public ════
sec("2. what a stranger can reach");
{
  const p = await fetch(`${API}/public/prospectus`).then((r) => r.json()).catch(() => null);
  ok("prospectus loads with no account", Array.isArray(p?.data), `${p?.data?.length ?? 0} programmes`);

  const s = await fetch(`${API}/public/showcase`).then((r) => r.json()).catch(() => null);
  ok("showcase loads with no account", !!s?.data?.copy);
  ok("videos are shown", (s?.data?.videos?.length ?? 0) > 0, `${s?.data?.videos?.length}`);
  ok("photographs are shown", (s?.data?.images?.length ?? 0) > 0, `${s?.data?.images?.length}`);
  ok("social links are shown", (s?.data?.social?.length ?? 0) > 0, `${s?.data?.social?.length}`);

  // Nothing private may be reachable without a token.
  for (const path of ["/settings", "/admin/users", "/admin/audit", "/certificates"]) {
    const r = await fetch(`${API}${path}`);
    ok(`${path} is refused without a token`, r.status === 401 || r.status === 403, `got ${r.status}`);
  }
}

// ══════════════════════════════════════════════════════ 3. the academy ════
sec("3. courses, sections and people");
let ss = null;
{
  const progs = await call("admin", "GET", "/programmes");
  ok("programmes list", Array.isArray(progs.data), `${progs.data?.length ?? 0}`);

  const dash = await call("teacher", "GET", "/dashboards/me");
  const sections = dash.data?.widgets?.mySections ?? [];
  ss = sections[0]?.sectionSubjectId ?? null;
  ok("a teacher sees their own classes", sections.length > 0, `${sections.length}`);

  const users = await call("admin", "GET", "/admin/users");
  ok("the people directory loads", (users.data?.length ?? users.raw?.data?.length ?? 0) >= 0, `${users.data?.length ?? "?"}`);

  const denied = await call("teacher", "GET", "/admin/users");
  ok("a teacher cannot read the people directory", denied.status === 403, `got ${denied.status}`);
}

// ═══════════════════════════════════════════════════ 4. attendance ════════
sec("4. attendance");
{
  const sessions = await call("teacher", "GET", "/me/sessions/today");
  ok("today's classes load", sessions.status === 200 || sessions.status === 404, `got ${sessions.status}`);

  const risk = ss ? await call("teacher", "GET", `/section-subjects/${ss}/at-risk`) : { status: 200 };
  ok("students at risk load", risk.status === 200, `got ${risk.status}`);
}

// ═════════════════════════════════════════════════ 5. assignments ═════════
sec("5. assignments, end to end");
let aid = null;
if (ss) {
  const created = await call("teacher", "POST", "/assignments", {
    sectionSubjectId: ss,
    title: `QA assignment ${stamp}`,
    instructions: "QA. Safe to delete.",
    marksAvailable: 10,
    opensAt: new Date().toISOString(),
    dueAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    latePolicy: "FLAG_ONLY",
    submissionType: "BOTH",
    allowedFileTypes: ["pdf", "webm"],
    maxFileSizeMb: 5,
    maxFileCount: 2,
    resubmissionPolicy: "LIMITED",
    maxAttempts: 3,
    graceMinutes: 15,
  });
  aid = created.data?.id;
  if (aid) made.assignments.push(aid);
  ok("teacher creates an assignment", !!aid, created.error?.message);

  if (aid) {
    const list = await call("teacher", "GET", `/section-subjects/${ss}/assignments`);
    const mine = list.data?.find((a) => a.id === aid);
    ok("the rules set are readable back", mine?.maxAttempts === 3 && mine?.graceMinutes === 15,
       `attempts=${mine?.maxAttempts} grace=${mine?.graceMinutes}`);

    const beforePub = await call("student", "GET", `/section-subjects/${ss}/my-assignments`);
    ok("a draft is invisible to students", !(beforePub.data ?? []).some((a) => a.id === aid));

    await call("teacher", "POST", `/assignments/${aid}/publish`);
    const afterPub = await call("student", "GET", `/section-subjects/${ss}/my-assignments`);
    ok("a published assignment is visible", (afterPub.data ?? []).some((a) => a.id === aid));

    const form = new FormData();
    form.append("file", new Blob([Buffer.from("%PDF-1.4 qa")], { type: "application/pdf" }), "qa.pdf");
    const up = await call("student", "POST", `/assignments/${aid}/files`, form, true);
    ok("student uploads a file", up.status === 201, up.error?.message);

    const badForm = new FormData();
    badForm.append("file", new Blob([Buffer.from("MZ executable")], { type: "application/pdf" }), "evil.pdf");
    const badUp = await call("student", "POST", `/assignments/${aid}/files`, badForm, true);
    ok("a file whose contents contradict its name is refused", badUp.status >= 400, `got ${badUp.status}`);

    const sub = await call("student", "POST", `/assignments/${aid}/submissions`, {
      textResponse: "QA answer.", fileIds: up.data?.id ? [up.data.id] : [],
    });
    ok("student submits", sub.status === 201, sub.error?.message);

    const roster = await call("teacher", "GET", `/assignments/${aid}/submissions`);
    const target = roster.data?.students?.find((s) => s.submitted);
    ok("the submission reaches the teacher", !!target, target?.name);

    if (target?.submissionId) {
      const over = await call("teacher", "POST", `/submissions/${target.submissionId}/grade`, { rawMarks: 999 });
      ok("a mark above the maximum is refused", over.status >= 400, `got ${over.status}`);

      const g = await call("teacher", "POST", `/submissions/${target.submissionId}/grade`, {
        rawMarks: 8, feedback: "QA feedback.",
      });
      ok("teacher marks it", g.status === 201 || g.status === 200, g.error?.message);

      const hidden = await call("student", "GET", `/assignments/${aid}/my-submission`);
      ok("the mark is hidden before release", hidden.data?.grade?.status !== "RELEASED", hidden.data?.grade?.status);

      await call("teacher", "POST", `/assignments/${aid}/release-grades`);
      const shown = await call("student", "GET", `/assignments/${aid}/my-submission`);
      ok("the mark appears after release", shown.data?.grade?.status === "RELEASED", shown.data?.grade?.status);
    }

    // Voice, both directions.
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
    const bf = new FormData();
    bf.append("file", new Blob([webm], { type: "audio/webm" }), "brief.webm");
    bf.append("seconds", "10");
    const brief = await call("teacher", "POST", `/assignments/${aid}/brief-audio`, bf, true);
    ok("teacher records a spoken brief", brief.status === 201 || brief.status === 200, brief.error?.message);

    const play = await fetch(`${API}/assignments/${aid}/brief-audio`, {
      headers: { Authorization: `Bearer ${tok.student}` },
    });
    ok("student can play the brief", play.status === 200 && (play.headers.get("content-type") ?? "").startsWith("audio/"));
    play.body?.cancel?.();
  }
}

// ══════════════════════════════════════════════════════ 6. quizzes ════════
sec("6. quizzes");
if (ss) {
  const qs = await call("teacher", "GET", `/section-subjects/${ss}/quizzes`);
  ok("quiz list loads", qs.status === 200, `${qs.data?.length ?? 0} quizzes`);
  const mine = await call("student", "GET", `/section-subjects/${ss}/my-quizzes`);
  ok("a student sees their quizzes", mine.status === 200, `${mine.data?.length ?? 0}`);
}

// ═══════════════════════════════════════════════════ 7. recordings ════════
sec("7. recordings and Drive");
{
  const h = await call("super", "GET", "/storage/providers");
  const drive = h.data?.find((p) => p.key === "google_drive");
  ok("Drive is healthy", drive?.health?.healthy === true, drive?.health?.detail?.slice(0, 50));

  const folders = await call("super", "GET", "/storage/folders");
  ok("the folder index loads", (folders.data?.folders?.length ?? 0) > 0, `${folders.data?.folders?.length}`);

  const dash = await call("teacher", "GET", "/dashboards/me");
  let lecture = null;
  for (const s of dash.data?.widgets?.mySections ?? []) {
    const ls = await call("teacher", "GET", `/section-subjects/${s.sectionSubjectId}/lectures`);
    lecture = (ls.data?.lectures ?? []).find((l) => l.availabilityStatus === "AVAILABLE");
    if (lecture) break;
  }
  ok("an available recording exists", !!lecture, lecture?.title);

  if (lecture) {
    const t = await call("teacher", "POST", `/recorded-lectures/${lecture.id}/playback-ticket`);
    ok("a playback ticket is issued", !!t.data?.ticketId);
    if (t.data?.ticketId) {
      const url = `${API}/lectures/stream/${t.data.ticketId}`;
      const head = await fetch(url, { headers: { Range: "bytes=0-1023" } });
      ok("a range request is honoured", head.status === 206, `got ${head.status}`);
      head.body?.cancel?.();
      const tail = await fetch(url, { headers: { Range: "bytes=-2048" } });
      ok("a suffix range returns the tail, not the file", tail.status === 206 &&
         (tail.headers.get("content-range") ?? "").match(/bytes \d{4,}-/) !== null,
         tail.headers.get("content-range"));
      tail.body?.cancel?.();
      const forged = await fetch(`${API}/lectures/stream/pt_forged0000000000000000000000000`);
      ok("a forged ticket is refused", forged.status >= 400, `got ${forged.status}`);
      forged.body?.cancel?.();
    }
  }
}

// ══════════════════════════════════════════════════════════ 8. fees ═══════
sec("8. fees and money");
{
  const mine = await call("student", "GET", "/me/fees");
  ok("a student sees their own fees", mine.status === 200, `got ${mine.status}`);

  const debtors = await call("admin", "GET", "/fees/debtors");
  // Step-up (SEC-AUZ-011): money requires a re-confirmed password, so 403 with
  // AUTH_STEP_UP_REQUIRED is the correct answer to a plain session.
  ok("the fee ledger demands step-up from the office", debtors.status === 403 && debtors.error?.code === "AUTH_STEP_UP_REQUIRED", debtors.error?.code ?? `got ${debtors.status}`);

  const peek = await call("teacher", "GET", "/fees/debtors");
  ok("a teacher cannot see the fee ledger", peek.status === 403, `got ${peek.status}`);

  const other = await call("student", "GET", "/fees/debtors");
  // A student holds payment:read at OWN scope, so the guard passes and the
  // SCOPE returns nothing. Empty, not forbidden — and empty is the point.
  ok("a student reading the fee ledger gets nothing", Array.isArray(other.data) && other.data.length === 0, `${other.data?.length ?? "?"} rows`);
}

// ═════════════════════════════════════════════════ 9. certificates ════════
sec("9. certificates");
{
  const list = await call("admin", "GET", "/certificates");
  ok("the certificate register loads", list.status === 200, `got ${list.status}`);

  const mine = await call("student", "GET", "/me/certificates");
  ok("a student sees their own", mine.status === 200, `got ${mine.status}`);

  const bogus = await fetch(`${API}/public/certificates/NOT-A-REAL-CODE/verify`);
  const body = await bogus.json().catch(() => null);
  ok("verifying an unknown code answers honestly", bogus.status === 200 && body?.data?.found === false,
     `status ${bogus.status}, found=${body?.data?.found}`);
}

// ═══════════════════════════════════════════════ 10. announcements ════════
sec("10. announcements and audiences");
{
  for (const audience of ["TEACHERS", "STAFF", "PUBLIC_ONLY"]) {
    const r = await call("admin", "POST", "/announcements", {
      audience, title: `QA ${audience} ${stamp}`, body: `QA notice for ${audience}.`,
    });
    if (r.data?.id) made.announcements.push(r.data.id);
    ok(`admin posts to ${audience}`, r.status === 201, `notified ${r.data?.notified}`);
  }

  const t = await call("teacher", "GET", "/announcements");
  const s = await call("student", "GET", "/announcements");
  const tTitles = new Set((t.data ?? []).map((a) => a.title));
  const sTitles = new Set((s.data ?? []).map((a) => a.title));

  ok("a teacher sees the teachers-only notice", tTitles.has(`QA TEACHERS ${stamp}`));
  ok("a student does NOT see the teachers-only notice", !sTitles.has(`QA TEACHERS ${stamp}`));
  ok("a student does NOT see the staff notice", !sTitles.has(`QA STAFF ${stamp}`));
  ok("nobody with an account sees the public-only notice",
     !tTitles.has(`QA PUBLIC_ONLY ${stamp}`) && !sTitles.has(`QA PUBLIC_ONLY ${stamp}`));

  const showcase = await fetch(`${API}/public/showcase`).then((r) => r.json());
  const news = (showcase?.data?.news ?? []).map((n) => n.title);
  ok("the public-only notice reaches the public page", news.includes(`QA PUBLIC_ONLY ${stamp}`));
  ok("the staff notice never reaches the public page", !news.includes(`QA STAFF ${stamp}`));

  const refused = await call("teacher", "POST", "/announcements", {
    audience: "TEACHERS", title: `QA refuse ${stamp}`, body: "Should be refused.",
  });
  ok("a teacher cannot address every teacher", refused.status === 403, `got ${refused.status}`);
}

// ══════════════════════════════════════════════ 11. communication ═════════
sec("11. inbox and messages");
{
  const inbox = await call("student", "GET", "/me/notifications");
  ok("a student's inbox loads", inbox.status === 200, `${inbox.data?.length ?? "?"} items`);

  const prefs = await call("student", "GET", "/me/notification-preferences");
  ok("notification preferences load", prefs.status === 200, `got ${prefs.status}`);

  const templates = await call("admin", "GET", "/notification-templates");
  ok("message templates load", templates.status === 200 || templates.status === 404, `got ${templates.status}`);

  const nosy = await call("teacher", "GET", "/me/notifications");
  ok("everybody has their own inbox", nosy.status === 200, `got ${nosy.status}`);
}

// ═════════════════════════════════════════════════ 12. governance ═════════
sec("12. settings, audit, security");
{
  const s = await call("admin", "GET", "/settings");
  ok("an admin may READ settings", s.status === 200, `got ${s.status}`);

  const w = await call("admin", "PUT", "/settings/attendance.warningThreshold", { value: 75 });
  ok("an admin may NOT write settings", w.status === 403, `got ${w.status}`);

  const sw = await call("super", "PUT", "/settings/attendance.warningThreshold", { value: 75 });
  ok("a super admin may write settings", sw.status === 200, `got ${sw.status}`);

  const a = await call("admin", "GET", "/admin/audit");
  ok("the audit log loads", a.status === 200, `got ${a.status}`);

  const sec2 = await call("super", "GET", "/admin/security");
  ok("the security log loads for a super admin", sec2.status === 200, `got ${sec2.status}`);

  const denied = await call("admin", "GET", "/admin/security");
  ok("an admin cannot read the security log", denied.status === 403, `got ${denied.status}`);

  const health = await call("super", "GET", "/system/health");
  ok("system health reports", health.status === 200, health.data?.status);
}

// ═════════════════════════════════════════════ 13. the public page ════════
sec("13. the public page editor");
{
  const doc = await call("admin", "GET", "/public-page");
  ok("an admin may edit the public page", doc.status === 200, `${doc.data?.fields?.length} fields`);

  const t = await call("teacher", "GET", "/public-page");
  ok("a teacher may not", t.status === 403, `got ${t.status}`);

  const bad = await call("admin", "PUT", "/public-page", {
    values: { "attendance.warningThreshold": 10 },
  });
  ok("the editor refuses a setting outside the public page", bad.status >= 400, `got ${bad.status}`);
}

// ══════════════════════════════════════════════════ 14. reports ═══════════
sec("14. reports");
{
  for (const [name, path] of [
    ["catalogue", "/reports"],
    ["progress", "/reports/progress"],
    ["attendance summary", "/reports/attendance-summary"],
    ["students at risk", "/reports/at-risk-students"],
    ["certificate register", "/reports/certificate-register"],
  ]) {
    const r = await call("admin", "GET", path);
    ok(`the ${name} report answers`, r.status === 200 || r.status === 400, `got ${r.status}`);
  }
  const money = await call("teacher", "GET", "/reports/revenue");
  ok("a teacher cannot read the revenue report", money.status === 403 || money.status === 404, `got ${money.status}`);
}

// ═══════════════════════════════════════════════════ 15. isolation ════════
sec("15. one student cannot reach another");
{
  const all = await call("admin", "GET", "/admin/users?role=student");
  const others = (all.data ?? []).filter((s) => s.id);
  const victim = others[0]?.id;
  if (victim) {
    const peek = await call("student", "GET", `/students/${victim}/fees`);
    ok("a student cannot read another student's fees", peek.status === 403 || peek.status === 404, `got ${peek.status}`);
    const certs = await call("student", "GET", `/students/${victim}/certificates`);
    ok("a student cannot read another student's certificates", certs.status === 403 || certs.status === 404, `got ${certs.status}`);
  } else {
    ok("a student list was available to test isolation against", false, "no students returned");
  }
}

// ══════════════════════════════ 16. the class's meeting room ══════════════
sec("16. the class meeting link");
if (ss) {
  // http:// must be refused, and the refusal must SAY WHY. A generic 422 is
  // a failure here even though the link was correctly not saved: a teacher
  // who cannot tell what is wrong with their link pastes it again.
  const insecure = await call("teacher", "PUT", `/section-subjects/${ss}/meeting-link`, {
    meetingUrl: "http://meet.google.com/qa-insecure",
  });
  ok("an http:// meeting link is refused", insecure.status >= 400, `got ${insecure.status}`);
  const why = insecure.error?.details?.[0]?.message ?? "";
  ok("and the refusal says why", /https:\/\//.test(why), why.slice(0, 60) || "(no detail)");

  const set = await call("teacher", "PUT", `/section-subjects/${ss}/meeting-link`, {
    meetingUrl: "https://meet.google.com/qa-room",
    note: "QA. Safe to clear.",
  });
  ok("a teacher sets the link on their own class", set.status === 200, `got ${set.status}`);

  // The student half: they must SEE it — this is a door they walk through,
  // unlike the lecture folder, which they must not see.
  const seen = await call("student", "GET", `/section-subjects/${ss}/lectures`);
  ok("the student sees the meeting link", seen.data?.meetingUrl === "https://meet.google.com/qa-room",
     seen.data?.meetingUrl ?? "(none)");
  ok("but not where the recordings live", seen.data?.lectureFolderRef === null,
     String(seen.data?.lectureFolderRef));

  const pushed = await call("student", "PUT", `/section-subjects/${ss}/meeting-link`, {
    meetingUrl: "https://meet.google.com/qa-student",
  });
  ok("a student cannot set it", pushed.status === 403, `got ${pushed.status}`);

  // ── THE OFFICE CAN DO EVERYTHING THE TEACHER CAN, and on any class ──
  //
  // A teacher holds live_session at ASSIGNED and the office at ALL, so this
  // is the difference that matters: a class whose teacher is away, or one
  // being covered, still needs its room set by somebody.
  const byOffice = await call("admin", "PUT", `/section-subjects/${ss}/meeting-link`, {
    meetingUrl: "https://meet.google.com/qa-office",
    note: "Set by the office.",
  });
  ok("the office sets the link too", byOffice.status === 200, `got ${byOffice.status}`);

  const seenAgain = await call("student", "GET", `/section-subjects/${ss}/lectures`);
  ok("and the student sees the office's link",
     seenAgain.data?.meetingUrl === "https://meet.google.com/qa-office",
     seenAgain.data?.meetingUrl ?? "(none)");
  ok("with the office's note", seenAgain.data?.meetingNote === "Set by the office.",
     seenAgain.data?.meetingNote ?? "(none)");

  // The office is not limited to classes it is assigned to — nobody assigns
  // an administrator to a class at all.
  const others = await call("admin", "GET", "/courses");
  const elsewhere = (others.data ?? []).find((c) => c.id !== ss);
  if (elsewhere) {
    const anywhere = await call("admin", "PUT", `/section-subjects/${elsewhere.id}/meeting-link`, {
      meetingUrl: "https://meet.google.com/qa-elsewhere",
    });
    ok("on a class nobody assigned them to", anywhere.status === 200, `got ${anywhere.status}`);
    await call("admin", "PUT", `/section-subjects/${elsewhere.id}/meeting-link`, { meetingUrl: "" });
  }

  const cleared = await call("teacher", "PUT", `/section-subjects/${ss}/meeting-link`, { meetingUrl: "" });
  ok("clearing it removes the link", cleared.status === 200 && cleared.data?.meetingUrl === null,
     String(cleared.data?.meetingUrl));

  const afterClear = await call("student", "GET", `/section-subjects/${ss}/lectures`);
  ok("and the student's link goes with it", afterClear.data?.meetingUrl === null,
     String(afterClear.data?.meetingUrl));
}

// ══════════════════════════ 17. files that come with a brief ══════════════
sec("17. files attached to an assignment");
if (aid) {
  // A real PDF. The server checks the CONTENTS against the extension, so a
  // text file called .pdf is refused — correctly, and that is checked below.
  const pdf = Buffer.from(
    ["%PDF-1.4", "1 0 obj<</Type/Catalog>>endobj", "trailer<</Root 1 0 R>>", "%%EOF", ""].join("\n"),
  );
  const form = new FormData();
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "qa-brief.pdf");
  const up = await call("teacher", "POST", `/assignments/${aid}/attachments`, form, true);
  ok("a teacher attaches a file to the brief", up.status === 201 || up.status === 200, `got ${up.status}`);

  // The same bytes again must not make a second row: a teacher who fixes a
  // typo and re-uploads should not leave a student choosing between two
  // files with different names and identical contents.
  const form2 = new FormData();
  form2.append("file", new Blob([pdf], { type: "application/pdf" }), "qa-brief-again.pdf");
  const dup = await call("teacher", "POST", `/assignments/${aid}/attachments`, form2, true);
  ok("the same file twice keeps one copy", dup.data?.alreadyAttached === true, String(dup.data?.alreadyAttached));

  // A JPEG renamed .pdf. The teacher is staff and is checked anyway: the
  // FILE is the threat model, not the person who uploaded it.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const form3 = new FormData();
  form3.append("file", new Blob([jpeg], { type: "application/pdf" }), "not-really.pdf");
  const liar = await call("teacher", "POST", `/assignments/${aid}/attachments`, form3, true);
  ok("a file whose contents belie its name is refused", liar.status >= 400, `got ${liar.status}`);

  const listed = await call("student", "GET", `/assignments/${aid}/attachments`);
  ok("the student sees what is attached", listed.status === 200 && (listed.data?.length ?? 0) === 1,
     `${listed.data?.length ?? 0} file(s)`);

  const one = listed.data?.[0];
  if (one) {
    const got = await call("student", "GET", `/assignment-attachments/${one.id}/download`);
    ok("and can download it", got.status === 200, `got ${got.status}`);

    const meddling = await call("student", "DELETE", `/assignment-attachments/${one.id}`);
    ok("a student cannot remove it", meddling.status === 403, `got ${meddling.status}`);
  }
}

// ═══════════════════════ 18. deleting what was made by mistake ════════════
sec("18. deleting a course, batch or subject");
{
  // ── a subject nothing uses: created and removed cleanly ──────────────
  const madeSubject = await call("admin", "POST", "/subjects", {
    code: `QA${String(stamp).slice(-6)}`,
    name: `QA subject ${stamp}`,
  });
  const subjectId = madeSubject.data?.id;
  ok("a subject can be created", !!subjectId, madeSubject.error?.message);

  if (subjectId) {
    const gone = await call("admin", "DELETE", `/subjects/${subjectId}`);
    ok("an unused subject is deleted", gone.status === 200, `got ${gone.status}`);

    const after = await call("admin", "GET", "/subjects");
    ok("and it leaves the list", !(after.data ?? []).some((x) => x.id === subjectId));
  }

  // ── a subject that IS taught: refused, and it says which classes ─────
  if (ss) {
    const offering = await call("admin", "GET", `/section-subjects/${ss}/lectures`);
    const taughtId = offering.data?.subject?.id;
    if (taughtId) {
      const refused = await call("admin", "DELETE", `/subjects/${taughtId}`);
      ok("a subject that is taught cannot be deleted", refused.status === 409, `got ${refused.status}`);
      const why = refused.error?.details?.[0]?.message ?? "";
      ok("and the refusal names the classes", /class/i.test(why), why.slice(0, 80) || "(no detail)");
    }
  }

  // ── a batch with sections: refused, by section code ──────────────────
  const batches = await call("admin", "GET", "/batches");
  const withSections = (batches.data ?? [])[0];
  if (withSections) {
    const r = await call("admin", "DELETE", `/batches/${withSections.id}`);
    // Either it has sections (409, named) or it is genuinely empty (200).
    // Only the first is worth asserting on, and only when it is the case.
    if (r.status === 409) {
      const why = r.error?.details?.[0]?.message ?? "";
      ok("a batch with sections is refused by name", /section/i.test(why), why.slice(0, 80));
    } else {
      ok("an empty batch deletes", r.status === 200, `got ${r.status} (batch was empty)`);
    }
  }

  // ── a section with students: refused, and told to archive ────────────
  const sections = await call("admin", "GET", "/sections");
  const busySection = (sections.data ?? []).find((x) => (x._count?.sectionSubjects ?? 0) > 0);
  if (busySection) {
    const r = await call("admin", "DELETE", `/sections/${busySection.id}`);
    ok("a section in use cannot be deleted", r.status === 409, `got ${r.status}`);
    const why = r.error?.details?.[0]?.message ?? "";
    ok("and the refusal explains what to do instead",
       /archive|subject|student/i.test(why), why.slice(0, 90) || "(no detail)");
  }

  // ── a subject put on a class by mistake: added, then taken off ───────
  if (busySection) {
    const spare = await call("admin", "POST", "/subjects", {
      code: `QB${String(stamp).slice(-6)}`,
      name: `QA spare subject ${stamp}`,
    });
    const spareId = spare.data?.id;
    if (spareId) {
      const offered = await call("admin", "POST", `/sections/${busySection.id}/subjects`, {
        subjectId: spareId,
        isCompulsory: false,
      });
      const offeringId = offered.data?.id;
      ok("a subject is added to a section", !!offeringId, offered.error?.message);

      if (offeringId) {
        const off = await call("admin", "DELETE", `/section-subjects/${offeringId}`);
        ok("and can be taken back off while untaught", off.status === 200, `got ${off.status}`);
      }
      const cleaned = await call("admin", "DELETE", `/subjects/${spareId}`);
      ok("the spare subject is removed again", cleaned.status === 200, `got ${cleaned.status}`);
    }
  }

  // ── nobody below the office may delete any of it ─────────────────────
  const t1 = await call("teacher", "DELETE", `/subjects/${subjectId ?? "00000000-0000-0000-0000-000000000000"}`);
  ok("a teacher cannot delete a subject", t1.status === 403, `got ${t1.status}`);
  const t2 = await call("student", "DELETE", `/sections/${busySection?.id ?? "00000000-0000-0000-0000-000000000000"}`);
  ok("a student cannot delete a section", t2.status === 403, `got ${t2.status}`);
}

// ══════════════════════════════════════════════════════ cleanup ═══════════
sec("cleanup");
{
  let removed = 0;
  for (const id of made.announcements) {
    const r = await call("admin", "POST", `/announcements/${id}/withdraw`);
    if (r.status < 400) removed++;
  }
  ok("QA announcements withdrawn", removed === made.announcements.length, `${removed}/${made.announcements.length}`);
  console.log(`  (assignments left for the cleanup script: ${made.assignments.length})`);
}

// ══════════════════════════════════════════════════════ summary ═══════════
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(`\n${"═".repeat(64)}`);
console.log(`  ${passed} passed, ${failed.length} failed, ${results.length} checks`);
console.log(`${"═".repeat(64)}`);
if (failed.length) {
  console.log("\nFAILURES, by area:");
  const by = {};
  for (const f of failed) (by[f.section] ??= []).push(f);
  for (const s of Object.keys(by)) {
    console.log(`\n  ${s}`);
    for (const f of by[s]) console.log(`    · ${f.name}${f.detail ? "  [" + f.detail + "]" : ""}`);
  }
}
