import { Fragment, useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { LandingPage } from "./pages/LandingPage";
import { ApplyPage } from "./pages/ApplyPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SectionsPage } from "./pages/SectionsPage";
import { StructurePage } from "./pages/StructurePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AdmissionsPage } from "./pages/AdmissionsPage";
import { AttendancePage } from "./pages/AttendancePage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { MySubjectsPage } from "./pages/MySubjectsPage";
import { SubjectPage } from "./pages/SubjectPage";
import { CoursePage } from "./pages/CoursePage";
import { CoursesPage } from "./pages/CoursesPage";
import { ClassPage } from "./pages/ClassPage";
import { WatchPage } from "./pages/WatchPage";
import { MarkingPage } from "./pages/MarkingPage";
import { GradingPage } from "./pages/GradingPage";
import { CompletionPage } from "./pages/CompletionPage";
import { QuizMarkingPage } from "./pages/QuizMarkingPage";
import { QuizBuilderPage } from "./pages/QuizBuilderPage";
import { ContentPage } from "./pages/ContentPage";
import { AssignmentBuilderPage } from "./pages/AssignmentBuilderPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditPage } from "./pages/AuditPage";
import { RubricsPage } from "./pages/RubricsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PublicPageEditorPage } from "./pages/PublicPageEditorPage";
import { PaymentSubmitPage } from "./pages/PaymentSubmitPage";
import { PaymentVerificationPage } from "./pages/PaymentVerificationPage";
import { SecurityPage } from "./pages/SecurityPage";
import { BulkPage } from "./pages/BulkPage";
import { CohortImportPage } from "./pages/CohortImportPage";
import { ReceiptPage } from "./pages/ReceiptPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { FeesPage } from "./pages/FeesPage";
import { TimetablePage } from "./pages/TimetablePage";
import { DiscussionPage } from "./pages/DiscussionPage";
import { BackupPage } from "./pages/BackupPage";
import { VerifyPage } from "./pages/VerifyPage";
import { MyCertificatesPage } from "./pages/MyCertificatesPage";
import { TrackPage } from "./pages/TrackPage";
import { CourseAdminPage } from "./pages/CourseAdminPage";
import { CourseEditPage } from "./pages/CourseEditPage";
import { SubjectEditPage } from "./pages/SubjectEditPage";
import { BatchEditPage } from "./pages/BatchEditPage";
import { CertificatesPage } from "./pages/CertificatesPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { NotificationBell } from "./components/NotificationBell";
import { ThemeToggle } from "./components/ThemeToggle";
import { Icon } from "./components/Icon";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { AccountMenu } from "./components/AccountMenu";
import { CommandPalette } from "./components/CommandPalette";
import { destinationsFor } from "./navigation";

/**
 * Application shell — SRS §13.1.
 *
 * UI-002: navigation is role-specific, so a user never sees an entry for
 * something they cannot do. This is a usability measure, NOT a security one —
 * ARC-003 puts the real decision on the server, and hiding a link protects
 * nobody. It exists so the interface does not offer things that will be
 * refused.
 */
export function App() {
  const { user, initialising, mustChangePassword, hasRole } = useAuth();
  const location = useLocation();
  // The mobile drawer. Closed on every navigation, because a menu still open
  // over the page you just chose is a menu you have to dismiss twice.
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /*
   * THE SIDEBAR'S WIDTH, and three states rather than two.
   *
   * "auto" is nobody having said — the stylesheet decides from the viewport,
   * full above 1180px and a rail below it, which is the right answer for a
   * laptop and for a tablet in landscape. The other two are somebody saying,
   * and somebody saying always wins at every width.
   *
   * Two states would mean picking an initial value at mount and then never
   * agreeing with the screen again after a resize.
   */
  const [rail, setRail] = useState<"auto" | "on" | "off">(() => {
    try {
      const v = localStorage.getItem("lms.rail");
      return v === "on" || v === "off" ? v : "auto";
    } catch {
      return "auto";
    }
  });

  const toggleRail = useCallback(() => {
    setRail((current) => {
      const wide = window.matchMedia("(min-width: 1181px)").matches;
      const isRail = current === "on" || (current === "auto" && !wide);
      const next = isRail ? "off" : "on";
      try {
        localStorage.setItem("lms.rail", next);
      } catch {
        // The choice holds for this tab and will not survive a reload. A
        // sidebar width is not worth failing a render over.
      }
      return next;
    });
  }, []);

  /*
   * Cmd-K, or Ctrl-K.
   *
   * On `window` rather than on any element, because the whole point is that it
   * works from wherever you are — including from inside a table somebody has
   * scrolled halfway down. preventDefault stops Firefox's own search bar
   * taking the same chord.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // FR-CRT-015 — certificate verification is PUBLIC, and is checked before the
  // authentication gate below. An employer holding a printed certificate has no
  // account, and sending them to a login screen would make the link useless.
  /*
   * `/verify` WITH NO CODE IS THE FRONT DOOR, and it did not exist.
   *
   * Every address here was `/verify/<something>`, which works for the one
   * person who scanned a QR code and for nobody else. An employer holding a
   * PRINTED certificate — no QR, or a camera that will not read it, or a
   * number read down the phone — had nowhere to go. The page already had a
   * lookup form on it, sitting under a heading that said "check ANOTHER
   * certificate", reachable only after successfully checking a first one.
   *
   * This is the same gap /track filled for applications: the page promised a
   * reference anybody could check, and there was nowhere to check it.
   */
  if (location.pathname === "/verify" || location.pathname.startsWith("/verify/")) {
    return (
      <Routes>
        {/* TWO SHAPES, ONE PAGE. The QR code on every certificate encodes
            /verify/certificate/<code>, which is the address a stranger's
            camera will open and the one to keep working forever. The bare
            /verify/<code> is what earlier links used, and it still resolves
            — a printed certificate cannot be reissued because an address was
            tidied up. */}
        <Route path="/verify/certificate/:code" element={<VerifyPage />} />
        <Route path="/verify/:code" element={<VerifyPage />} />
        {/* Nothing to look up yet: the page renders as the form. */}
        <Route path="/verify" element={<VerifyPage />} />
      </Routes>
    );
  }

  /*
   * FR-REG-020 — tracking an application is PUBLIC, and checked here for the
   * same reason certificate verification is.
   *
   * An applicant has no account and cannot be given one until they are
   * admitted, so this must work signed out. It is checked BEFORE the
   * authentication gate rather than only inside the signed-out branch, because
   * the link in the confirmation email is opened on whatever device is to hand
   * — often a shared one, where somebody else is already signed in. Falling
   * through to the application shell there would answer a stranger's emailed
   * link with a student's dashboard.
   */
  if (location.pathname === "/track" || location.pathname.startsWith("/track/")) {
    return (
      <Routes>
        <Route path="/track" element={<TrackPage />} />
        <Route path="/track/:trackingRef" element={<TrackPage />} />
      </Routes>
    );
  }

  /**
   * The public page, viewable while signed in.
   *
   * It is what a stranger sees, and until now the only way to look at it was to
   * sign out — so the person who edits the videos, the photographs and the
   * public notices could not see the result of any of it without losing their
   * session. `/home` renders exactly the same component, with no sidebar and no
   * chrome, so what is being previewed IS the page rather than an approximation
   * of it.
   */
  if (location.pathname === "/home") {
    return <LandingPage />;
  }

  // Distinguishing "still checking" from "signed out" avoids flashing the
  // login screen at a user who is in fact signed in.
  if (initialising) {
    return (
      <div className="auth-shell">
        <p className="muted">Checking your session…</p>
      </div>
    );
  }

  /**
   * SIGNED OUT, THE ROOT IS THE PUBLIC FRONT — not the sign-in form.
   *
   * Most people arriving at this address have no account and are not trying to
   * get one in the next ten seconds: they want to know what the Institute
   * teaches. Putting a password box in front of them asks a question they
   * cannot answer. `/login` is still the form, and everything else a signed-out
   * visitor asks for lands on the landing page rather than a 404, because a
   * stale link from anywhere should reach something that explains itself.
   */
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* FR-REG-001 — no account, no login. The whole point of the public
            application is that the person filling it in cannot have one. */}
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    );
  }

  // FR-REG-040 — a provisioned account sets its own password before it can
  // go anywhere else.
  if (mustChangePassword) return <ChangePasswordPage forced />;

  const initials = (user.fullName || user.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  /**
   * The role, said in words a person uses.
   *
   * `super_admin` on screen is a database value leaking into the interface.
   * The most senior role is shown when somebody holds several, because that is
   * the one that explains what they can see.
   */
  const roleLabel = hasRole("super_admin")
    ? "Super Admin"
    : hasRole("admin")
      ? "Administrator"
      : hasRole("teacher")
        ? "Teacher"
        : "Student";

  const destinations = destinationsFor(hasRole);
  // The chord as this keyboard writes it. "Ctrl K" shown to somebody on a Mac
  // is a shortcut that does not work.
  const modKey =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘"
      : "Ctrl ";
  const layoutClass =
    "layout" + (rail === "on" ? " is-collapsed" : rail === "off" ? " is-expanded" : "");

  return (
    <div className="shell">
      {/*
        THE FIRST FOCUSABLE THING ON THE PAGE.

        The sidebar is rendered before the content and holds up to twenty-four
        links, so a keyboard or screen-reader user was tabbing through the
        whole navigation on every screen before reaching what they came for
        (WCAG 2.4.1). None of the static checks could have found this: they
        read markup, and this is about order.
      */}
      <a className="skip-link" href="#main-content">
        Skip to the content
      </a>

      {/* Above everything, so it is the first thing on the page and cannot be
          scrolled past (SEC-AUZ-013). */}
      <ImpersonationBanner />

      <div className={layoutClass}>
        {/*
          GROUPED, because there are two dozen destinations and a Super Admin
          sees most of them. Wrapped across the top they were a wall of words
          in which nothing could be found twice; the group heading is what
          tells somebody where to look. The groups are by WHAT YOU ARE DOING —
          teaching, money, running the place — rather than by which permission
          happens to guard them.

          RENDERED FROM A LIST NOW, not written out by hand. The command
          palette searches the same destinations, and two hand-written copies
          of this list would be two places for a role predicate to be wrong.
          The predicates themselves are unchanged and live in navigation.ts
          with the reasoning beside each one.
        */}
        <aside id="sidebar" className={`sidebar${navOpen ? " open" : ""}`}>
          {/*
            THE REAL EMBLEM, and the real tagline.

            The mark was a "P" drawn in CSS on an indigo gradient. §2.3 is
            blunt about that — "Recreate the logo from scratch — always use
            the master asset" — so this is the emblem cut from
            ppship-logo.png, with the wordmark dropped out as §2.4 requires at
            this size.

            The sub-label said "Learning". §1.2 makes "Dream. Learn. Earn."
            the tagline, with exact punctuation, on every page without
            exception — so it is here, in the one piece of furniture that is
            genuinely on every page.

            `alt=""` because the words are right beside it: an emblem that
            announced itself would make a screen reader say the brand twice.
          */}
          <NavLink to="/" end className="brand" onClick={() => setNavOpen(false)}>
            <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
            <span className="brand-words">
              Prepreneurship
              <span className="brand-sub">Dream. Learn. Earn.</span>
            </span>
          </NavLink>

          <nav className="nav" onClick={() => setNavOpen(false)}>
            {destinations.map((d, i) => {
              // A heading whenever the group changes. Decided here rather than
              // held in the data, so a group whose every entry this role
              // cannot see does not leave its title behind.
              const previous = destinations[i - 1];
              const heading =
                d.group && d.group !== previous?.group ? (
                  <div className="nav-group">{d.group}</div>
                ) : null;

              // `title` gives the rail a name under the pointer. The label
              // itself stays in the markup and is only clipped, so the
              // accessible name is the word either way.
              const inside = (
                <>
                  <Icon name={d.icon} />
                  <span className="nav-label">{d.label}</span>
                </>
              );

              return (
                <Fragment key={d.to}>
                  {heading}
                  {d.leavesApp ? (
                    // An ordinary link: it leaves the application shell
                    // entirely, which is the point — a preview inside the
                    // sidebar would not be a preview of anything.
                    <a href={d.to} title={d.label}>
                      {inside}
                    </a>
                  ) : (
                    <NavLink to={d.to} end={d.to === "/"} title={d.label}>
                      {inside}
                    </NavLink>
                  )}
                </Fragment>
              );
            })}
          </nav>

          {/* Whose session this is, at a glance and without opening anything.
              What you DO about it — change password, appearance, sign out —
              moved to the account menu in the top strip, because reaching it
              here meant scrolling past every destination on a phone. */}
          <div className="sidebar-foot">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="who">
              <strong>{user.fullName || user.email}</strong>
              <span>{roleLabel}</span>
            </span>
          </div>
        </aside>

        {/* Tapping away closes the drawer, which is what every phone user
            expects and what stops them being trapped in it. */}
        {/*
          The backdrop behind the mobile drawer. A real <button> rather than a
          div with a click handler: a div cannot be tabbed to and does not fire
          on Enter, so on a phone with a keyboard the menu could be opened and
          not closed. It carries a name because a button with no text is
          announced as just "button".
        */}
        {navOpen && (
          <button
            type="button"
            className="scrim"
            aria-label="Close the menu"
            onClick={() => setNavOpen(false)}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/*
            The top strip used to hold a hamburger that is hidden above 900px
            and a bell — so on every desktop screen it was an empty band with
            one control in it. It now carries the three things that belong to
            the application rather than to any one page: how to find something,
            what is waiting, and who you are signed in as.
          */}
          <header className="topbar">
            <button
              className="btn btn-quiet menu-button"
              onClick={() => setNavOpen((o) => !o)}
              aria-label="Menu"
              aria-expanded={navOpen}
              aria-controls="sidebar"
            >
              <Icon name="menu" />
            </button>
            <button
              type="button"
              className="icon-btn sidebar-collapse"
              onClick={toggleRail}
              aria-label="Narrow or widen the sidebar"
              title="Narrow or widen the sidebar"
              aria-controls="sidebar"
            >
              <Icon name="panel" />
            </button>
            <button
              type="button"
              className="search-trigger"
              onClick={() => setPaletteOpen(true)}
              aria-label="Go to a screen"
            >
              <Icon name="search" />
              <span className="search-trigger-label">Go to…</span>
              <span className="kbd">{modKey}K</span>
            </button>
            <div className="topbar-right">
              {/* Before the inbox and the account menu, because it is the one
                  control here that changes the SCREEN rather than showing
                  something — and because "this is too bright" is not a thing
                  anybody thinks to look for under their own name. */}
              <ThemeToggle />
              <NotificationBell />
              <AccountMenu initials={initials} roleLabel={roleLabel} />
            </div>
          </header>

      {/*
        A class naming the page, so each screen can have its own identity
        without thirty-five stylesheets that drift apart.

        Derived from the address rather than passed down, because the route
        already knows where it is and threading a prop through every page would
        be a second place to keep in step. The hue lands on the page heading and
        matches the sidebar icon for the same destination, so the colour a
        person clicked is the colour they arrive at.
      */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* `tabIndex={-1}` is what makes the skip link land: an element the
          browser cannot focus is one it jumps straight past. It adds no tab
          stop of its own. */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`main page-${location.pathname.split("/")[1] || "dashboard"}`}
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          {/*
            SIGNING IN LEFT YOU ON A NOT-FOUND PAGE.

            The sign-in form lives at /login, and nothing navigated away from it
            afterwards — the session simply appeared and this route table took
            over. /login is not in it, so the catch-all below caught it and
            showed "page not found" to somebody who had just successfully
            signed in. The same for /apply, which a signed-in visitor reaches by
            using the browser's back button.

            Redirecting rather than rendering the dashboard at those addresses,
            so the URL bar ends up saying / and a reload does the right thing.
          */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/apply" element={<Navigate to="/" replace />} />
          <Route
            path="/admissions"
            element={hasRole("super_admin", "admin") ? <AdmissionsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/attendance"
            element={
              hasRole("super_admin", "admin", "teacher") ? <AttendancePage /> : <Navigate to="/" replace />
            }
          />
          {/* A student's own material. The server refuses these for anyone
              else (ARC-003); the role check here only keeps the interface from
              offering a page that would be refused. */}
          <Route
            path="/subjects"
            element={hasRole("student") ? <MySubjectsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/subjects/:sectionSubjectId"
            element={hasRole("student") ? <SubjectPage /> : <Navigate to="/" replace />}
          />
          {/* Marking. The server refuses these for a student (ARC-003); the
              role check only keeps the interface from offering a refused page. */}
          {/* FR-CRT — a teacher signs off their own classes; the office issues.
              STAFF, because an administrator may sign off too when a teacher
              has left, and the scope predicate limits a teacher to their own. */}
          <Route
            path="/completion/:sectionSubjectId"
            element={
              hasRole("super_admin", "admin", "teacher") ? <CompletionPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/marking"
            element={
              hasRole("super_admin", "admin", "teacher") ? <MarkingPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/marking/:assignmentId"
            element={
              hasRole("super_admin", "admin", "teacher") ? <GradingPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/content"
            element={
              hasRole("super_admin", "admin", "teacher") ? <ContentPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/assignment-builder"
            element={
              hasRole("super_admin", "admin", "teacher") ? <AssignmentBuilderPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/quiz-builder"
            element={
              hasRole("super_admin", "admin", "teacher") ? <QuizBuilderPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/quiz-builder/:quizId"
            element={
              hasRole("super_admin", "admin", "teacher") ? <QuizBuilderPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/marking/quiz/:quizId"
            element={
              hasRole("super_admin", "admin", "teacher") ? <QuizMarkingPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/users"
            element={hasRole("super_admin", "admin") ? <UsersPage /> : <Navigate to="/" replace />}
          />
          {/* An Admin sees only their own actions here, a Super Admin sees
              everything (§4.5.12). The route is open to both because the
              narrower view is genuinely useful — an administrator checking
              what they did last Tuesday. */}
          <Route
            path="/audit"
            element={hasRole("super_admin", "admin") ? <AuditPage /> : <Navigate to="/" replace />}
          />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/discussions" element={<DiscussionPage />} />
          <Route path="/discussions/:sectionSubjectId" element={<DiscussionPage />} />
          {/* A student sees their own statement, staff see the list. A teacher
              has no business in anybody's finances and the server refuses them,
              so the route sends them home rather than to an error. */}
          <Route
            path="/fees"
            element={
              hasRole("super_admin", "admin", "student") ? <FeesPage /> : <Navigate to="/" replace />
            }
          />
          {/* STUDENTS ALONE, and that is not a permission decision — an
              administrator holds `payment_submission:create` too. It is that
              this form submits AS THE PERSON FILLING IT IN: the service takes
              the student from the session, so a clerk who opened it would be
              claiming a payment against their own record. An administrator
              recording money over the counter uses "Record a payment" on the
              student's statement, which is a different act with a different
              permission. */}
          <Route
            path="/fees/submit"
            element={hasRole("student") ? <PaymentSubmitPage /> : <Navigate to="/fees" replace />}
          />
          {/* The fee desk. `payment_submission:approve` is Super Admin and
              Admin at step-up; the server asks for the password, and this test
              only decides whether the door is offered (UI-002). */}
          <Route
            path="/fees/verification"
            element={
              hasRole("super_admin", "admin") ? (
                <PaymentVerificationPage />
              ) : (
                <Navigate to="/fees" replace />
              )
            }
          />
          {/* Admin too: bulk_operation reaches an Admin holding the
              bulk_operator sub-permission, and the server decides. Hiding the
              page from every Admin would hide it from the ones who may. */}
          <Route
            path="/bulk"
            element={hasRole("super_admin", "admin") ? <BulkPage /> : <Navigate to="/" replace />}
          />
          {/* Same authority as a bulk change, for the same reason: loading
              three hundred students is a different kind of act from admitting
              one, and bulk_operator is what says so. */}
          <Route
            path="/import"
            element={
              hasRole("super_admin", "admin") ? <CohortImportPage /> : <Navigate to="/" replace />
            }
          />
          {/* A receipt is a document with an address, so it can be opened,
              printed and reopened. A STUDENT reaches their own: they hold
              payment:read at OWN scope, and the scope predicate is what stops
              them opening anybody else's rather than a check here. */}
          <Route
            path="/receipts/:paymentId"
            element={
              hasRole("super_admin", "admin", "student") ? (
                <ReceiptPage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          {/* notification_config:configure, which §4.5 gives Super Admin and
              Admin. A teacher writes announcements; the Institute's standing
              wording for what the System says is a different authority. */}
          <Route
            path="/messages"
            element={
              hasRole("super_admin", "admin") ? <TemplatesPage /> : <Navigate to="/" replace />
            }
          />
          {/* Super Admin alone: `backup` and `restore` reach nobody else. */}
          <Route
            path="/backups"
            element={hasRole("super_admin") ? <BackupPage /> : <Navigate to="/" replace />}
          />
          {/* Super Admin ALONE (4.5). Unlike the audit log there is no Admin
              tier: this log names who has been attacked and from where, and is
              as useful for investigating a colleague as for defending one. */}
          <Route
            path="/security"
            element={hasRole("super_admin") ? <SecurityPage /> : <Navigate to="/" replace />}
          />
          {/* An Admin may READ institute policy and not change it (§4.5), so
              the route is open to both and the inputs decide. Refusing the page
              would hide from an administrator the rules they administer. */}
          <Route
            path="/settings"
            element={hasRole("super_admin", "admin") ? <SettingsPage /> : <Navigate to="/" replace />}
          />
          {/*
            FR-PUB — what a stranger sees, edited by the people who know it is
            wrong.

            BOTH ROLES, unlike /settings above, and that difference is the whole
            point of the screen. Writing a setting is Super Admin only because a
            setting decides when a student is warned; nothing reachable here
            decides anything about anybody, and the person who knows a new reel
            went up this morning is the one running admissions. The server
            grants `public_page:configure` to both and narrows what it reaches
            to the Public page settings alone — this test only decides whether
            the destination is offered (UI-002).
          */}
          <Route
            path="/public-page"
            element={
              hasRole("super_admin", "admin") ? <PublicPageEditorPage /> : <Navigate to="/" replace />
            }
          />
          {/* Teacher and above. A student may READ a rubric they are marked
              against, but that belongs beside their grade, not on an
              authoring screen. */}
          <Route
            path="/rubrics"
            element={
              hasRole("super_admin", "admin", "teacher") ? <RubricsPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/certificates"
            element={
              hasRole("super_admin", "admin") ? <CertificatesPage /> : <Navigate to="/" replace />
            }
          />
          {/*
            FR-CRT-015 — a student's own certificates, at their own address.

            SEPARATE FROM /certificates ABOVE, deliberately. That one is the
            REGISTER: every holder's name and course on one screen, guarded by
            the issuing permission because reading it is reading about other
            students. This one is `certificate:read` at OWN scope, which the
            server narrows to their own rows — so the two screens cannot be
            made to show each other's data whatever this test says (UI-002).

            Students only, because /me/certificates resolves the holder from
            the signed-in account's student record and refuses an account that
            has none. Offering the destination to a teacher would be offering
            them a refusal.
          */}
          <Route
            path="/my-certificates"
            element={hasRole("student") ? <MyCertificatesPage /> : <Navigate to="/" replace />}
          />
          {/* Everyone: reading is universal, and the composer inside decides
              for itself whether this user may post. */}
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/sections" element={<SectionsPage />} />
          <Route path="/structure" element={<StructurePage />} />
          {/* FR-CRS-004/015, FR-PAY-033 — creating the courses themselves,
              giving them a picture and setting their price. A teacher may read
              programmes and subjects but holds no create on either and no
              fee_structure grant beyond read, so offering them this page would
              be offering three refusals. */}
          <Route
            path="/courses-admin"
            element={
              hasRole("super_admin", "admin") ? <CourseAdminPage /> : <Navigate to="/" replace />
            }
          />
          {/*
            A PAGE PER THING, rather than a panel inside a card.

            The panels had no address, so a half-finished course could not be
            linked to, bookmarked or refreshed; the card had to swallow the
            whole row to give the form any width; and there was no room for the
            fields that matter — which is how twenty of twenty-four batches
            ended up with no teacher.

            `/new` and `/:id` share a component: creating and editing a course
            ask almost the same questions, and two components would be two
            places for the answer to drift.
          */}
          <Route
            path="/courses-admin/course/:courseId"
            element={
              hasRole("super_admin", "admin") ? <CourseEditPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/courses-admin/subject/:subjectId"
            element={
              hasRole("super_admin", "admin") ? <SubjectEditPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/courses-admin/batch/new"
            element={
              hasRole("super_admin", "admin") ? <BatchEditPage /> : <Navigate to="/" replace />
            }
          />
          {/* One class's recordings. Everyone: a student sees the published
              ones on classes they are enrolled in and staff see drafts too,
              which the server decides — the scope predicate refuses a class
              somebody is not on either way. */}
          {/* The index. Without it the course page was reachable only by
              knowing a UUID, or by drilling three levels into Sections. */}
          {/* One scheduled class: countdown, one press to join, attendance
              recorded at that moment. The join button used to do nothing. */}
          <Route path="/classes/:sessionId" element={<ClassPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:sectionSubjectId" element={<CoursePage />} />
          {/* Watching has its own address, so it can be bookmarked,
              opened in a new tab and returned to with the back button. */}
          <Route
            path="/courses/:sectionSubjectId/watch/:lectureId"
            element={<WatchPage />}
          />
          <Route
            path="/integrations"
            element={
              hasRole("super_admin", "admin", "teacher") ? (
                <IntegrationsPage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/change-password" element={<ChangePasswordPage forced={false} />} />
          <Route
            path="/reports"
            element={
              hasRole("super_admin", "admin", "teacher") ? <ReportsPage /> : <Navigate to="/" replace />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p className="muted">That address does not exist.</p>
      <NavLink className="btn" to="/">
        Back to dashboard
      </NavLink>
    </div>
  );
}
