import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SectionsPage } from "./pages/SectionsPage";
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
import { VerifyPage } from "./pages/VerifyPage";
import { CertificatesPage } from "./pages/CertificatesPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { NotificationBell } from "./components/NotificationBell";
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

  if (!user) return <LoginPage />;

  // FR-REG-040 — a provisioned account sets its own password before it can
  // go anywhere else.
  if (mustChangePassword) return <ChangePasswordPage forced />;

  return (
    <div className="shell">
      {/* Above the header, so it is the first thing on the page and cannot be
          scrolled past (SEC-AUZ-013). */}
      <ImpersonationBanner />
      <header className="topbar">
        <div className="brand">LMS</div>
        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          {hasRole("student") && <NavLink to="/subjects">My subjects</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/admissions">Admissions</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/certificates">Certificates</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/users">People</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/audit">Audit</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/settings">Settings</NavLink>}
          {hasRole("super_admin") && <NavLink to="/security">Security</NavLink>}
          {hasRole("super_admin", "admin", "teacher") && (
            <NavLink to="/attendance">Attendance</NavLink>
          )}
          {hasRole("super_admin", "admin", "teacher") && <NavLink to="/marking">Marking</NavLink>}
          {hasRole("super_admin", "admin", "teacher") && <NavLink to="/rubrics">Rubrics</NavLink>}
          {hasRole("super_admin", "admin", "teacher") && <NavLink to="/content">Content</NavLink>}
          <NavLink to="/announcements">Announcements</NavLink>
          <NavLink to="/sections">Sections</NavLink>
          {hasRole("super_admin", "admin", "teacher") && <NavLink to="/reports">Reports</NavLink>}
        </nav>
        <div className="topbar-right">
          <NotificationBell />
          <span className="muted small">{user.fullName || user.email || user.roles.join(", ")}</span>
          <button className="btn btn-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
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
