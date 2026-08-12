import { useState } from "react";
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
import { MarkingPage } from "./pages/MarkingPage";
import { GradingPage } from "./pages/GradingPage";
import { QuizMarkingPage } from "./pages/QuizMarkingPage";
import { QuizBuilderPage } from "./pages/QuizBuilderPage";
import { ContentPage } from "./pages/ContentPage";
import { AssignmentBuilderPage } from "./pages/AssignmentBuilderPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditPage } from "./pages/AuditPage";
import { RubricsPage } from "./pages/RubricsPage";
import { SettingsPage } from "./pages/SettingsPage";
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
import { CertificatesPage } from "./pages/CertificatesPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { NotificationBell } from "./components/NotificationBell";
import { Icon } from "./components/Icon";
import { ImpersonationBanner } from "./components/ImpersonationBanner";

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
  const { user, initialising, mustChangePassword, signOut, hasRole } = useAuth();
  const location = useLocation();
  // The mobile drawer. Closed on every navigation, because a menu still open
  // over the page you just chose is a menu you have to dismiss twice.
  const [navOpen, setNavOpen] = useState(false);

  // FR-CRT-015 — certificate verification is PUBLIC, and is checked before the
  // authentication gate below. An employer holding a printed certificate has no
  // account, and sending them to a login screen would make the link useless.
  if (location.pathname.startsWith("/verify/")) {
    return (
      <Routes>
        <Route path="/verify/:code" element={<VerifyPage />} />
      </Routes>
    );
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

  return (
    <div className="shell">
      {/* Above everything, so it is the first thing on the page and cannot be
          scrolled past (SEC-AUZ-013). */}
      <ImpersonationBanner />

      <div className="layout">
        {/*
          GROUPED, because there are twenty-one destinations and a Super Admin
          sees most of them. Wrapped across the top they were a wall of words in
          which nothing could be found twice; the group heading is what tells
          somebody where to look. The groups are by WHAT YOU ARE DOING —
          teaching, money, running the place — rather than by which permission
          happens to guard them.
        */}
        <aside id="sidebar" className={`sidebar${navOpen ? " open" : ""}`}>
          <NavLink to="/" end className="brand" onClick={() => setNavOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              P
            </span>
            <span>
              Prepreneurship
              <span className="brand-sub">Learning</span>
            </span>
          </NavLink>

          <nav className="nav" onClick={() => setNavOpen(false)}>
            <NavLink to="/" end>
              <Icon name="dashboard" />
              Dashboard
            </NavLink>
            <NavLink to="/timetable">
              <Icon name="calendar" />
              Timetable
            </NavLink>
            <NavLink to="/announcements">
              <Icon name="megaphone" />
              Announcements
            </NavLink>

            {hasRole("student") && (
              <>
                <div className="nav-group">Learning</div>
                <NavLink to="/subjects">
                  <Icon name="book" />
                  My subjects
                </NavLink>
              </>
            )}
            {hasRole("student", "teacher") && (
              <NavLink to="/discussions">
                <Icon name="chat" />
                Discussion
              </NavLink>
            )}

            {hasRole("super_admin", "admin", "teacher") && (
              <>
                <div className="nav-group">Teaching</div>
                <NavLink to="/attendance">
                  <Icon name="check" />
                  Attendance
                </NavLink>
                <NavLink to="/marking">
                  <Icon name="pen" />
                  Marking
                </NavLink>
                <NavLink to="/rubrics">
                  <Icon name="clipboard" />
                  Rubrics
                </NavLink>
                <NavLink to="/content">
                  <Icon name="layers" />
                  Content
                </NavLink>
              </>
            )}

            {hasRole("super_admin", "admin") && (
              <>
                <div className="nav-group">Students</div>
                <NavLink to="/admissions">
                  <Icon name="clipboard" />
                  Admissions
                </NavLink>
                <NavLink to="/users">
                  <Icon name="users" />
                  People
                </NavLink>
                <NavLink to="/certificates">
                  <Icon name="award" />
                  Certificates
                </NavLink>
                <NavLink to="/import">
                  <Icon name="upload" />
                  Import
                </NavLink>
                <NavLink to="/bulk">
                  <Icon name="shuffle" />
                  Bulk changes
                </NavLink>
              </>
            )}

            <div className="nav-group">Institute</div>
            <NavLink to="/sections">
              <Icon name="layers" />
              Sections
            </NavLink>
            {/* Terms and batches. A teacher and a student may read the
                structure; only an Admin sees the forms, which the page decides
                for itself rather than being hidden wholesale here. */}
            <NavLink to="/structure">
              <Icon name="calendar" />
              Structure
            </NavLink>
            {/* A TEACHER holds no `payment` grant at all (§4.5) — offering
                them the page would be offering a 403. */}
            {hasRole("super_admin", "admin", "student") && (
              <NavLink to="/fees">
                <Icon name="money" />
                Fees
              </NavLink>
            )}
            {hasRole("super_admin", "admin", "teacher") && (
              <NavLink to="/reports">
                <Icon name="chart" />
                Reports
              </NavLink>
            )}

            {/* A teacher holds provider_binding:read and needs it — whether a
                Meet link is created for them or they must paste one in changes
                what they do before class. A student holds no such grant. */}
            {hasRole("super_admin", "admin", "teacher") && (
              <NavLink to="/integrations">
                <Icon name="shuffle" />
                Integrations
              </NavLink>
            )}

            {hasRole("super_admin", "admin") && (
              <>
                <div className="nav-group">Administration</div>
                <NavLink to="/settings">
                  <Icon name="settings" />
                  Settings
                </NavLink>
                <NavLink to="/messages">
                  <Icon name="bell" />
                  Messages
                </NavLink>
                <NavLink to="/audit">
                  <Icon name="clipboard" />
                  Audit
                </NavLink>
              </>
            )}
            {hasRole("super_admin") && (
              <>
                <NavLink to="/security">
                  <Icon name="shield" />
                  Security
                </NavLink>
                <NavLink to="/backups">
                  <Icon name="database" />
                  Backups
                </NavLink>
              </>
            )}
          </nav>

          <div className="sidebar-foot">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="who">
              <strong>{user.fullName || user.email}</strong>
              <span>{roleLabel}</span>
            </span>
            <button
              className="btn btn-quiet"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" />
            </button>
          </div>
        </aside>

        {/* Tapping away closes the drawer, which is what every phone user
            expects and what stops them being trapped in it. */}
        {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

        <div style={{ flex: 1, minWidth: 0 }}>
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
            <div className="topbar-right">
              <NotificationBell />
            </div>
          </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
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
          {/* Everyone: reading is universal, and the composer inside decides
              for itself whether this user may post. */}
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/sections" element={<SectionsPage />} />
          <Route path="/structure" element={<StructurePage />} />
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
