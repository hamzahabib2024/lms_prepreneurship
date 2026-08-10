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
import { VerifyPage } from "./pages/VerifyPage";
import { CertificatesPage } from "./pages/CertificatesPage";

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
      <header className="topbar">
        <div className="brand">LMS</div>
        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          {hasRole("student") && <NavLink to="/subjects">My subjects</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/admissions">Admissions</NavLink>}
          {hasRole("super_admin", "admin") && <NavLink to="/certificates">Certificates</NavLink>}
          {hasRole("super_admin", "admin", "teacher") && (
            <NavLink to="/attendance">Attendance</NavLink>
          )}
          {hasRole("super_admin", "admin", "teacher") && <NavLink to="/marking">Marking</NavLink>}
          <NavLink to="/sections">Sections</NavLink>
          {hasRole("super_admin", "admin", "teacher") && <NavLink to="/reports">Reports</NavLink>}
        </nav>
        <div className="topbar-right">
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
            path="/marking/quiz/:quizId"
            element={
              hasRole("super_admin", "admin", "teacher") ? <QuizMarkingPage /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/certificates"
            element={
              hasRole("super_admin", "admin") ? <CertificatesPage /> : <Navigate to="/" replace />
            }
          />
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
