import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SectionsPage } from "./pages/SectionsPage";
import { ReportsPage } from "./pages/ReportsPage";

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
  if (mustChangePassword) return <ChangePasswordGate />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">LMS</div>
        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
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
          <Route path="/sections" element={<SectionsPage />} />
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

/** FR-REG-040 / SEC-AUT-013 — no navigation until the password is changed. */
function ChangePasswordGate() {
  const { completePasswordChange } = useAuth();
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <h1 className="auth-title">Set your password</h1>
        <p className="muted">
          Your account was created with a temporary password. Choose your own before continuing.
        </p>
        <div className="alert alert-warn">
          <p>
            The change form is not built yet. Until it is, this gate makes the requirement visible
            rather than letting a provisioned account roam with a shared password.
          </p>
        </div>
        <button className="btn btn-quiet" onClick={completePasswordChange}>
          Continue anyway (development only)
        </button>
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
