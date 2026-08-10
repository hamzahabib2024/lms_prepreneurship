import { useEffect, useState } from "react";
import { api, tokens } from "../api/client";

/**
 * SEC-AUZ-013 — you are acting as somebody else.
 *
 * THE MOST IMPORTANT THING ON THE PAGE WHEN IT IS SHOWING. An impersonated
 * session is, by design, indistinguishable from the real person's: same
 * screens, same data, same permissions. That is what makes it useful for
 * support and what makes it dangerous. Without a banner, a Super Admin can
 * forget which identity they are in and act as somebody else believing they are
 * acting as themselves.
 *
 * So it sits above everything, is not dismissible, and states three things: who
 * you are acting as, that it ends by itself, and how to leave now.
 */
export function ImpersonationBanner() {
  const [state, setState] = useState<{ realUser: { fullName: string } } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    api
      .get<{ impersonating: boolean; realUser?: { fullName: string } }>("/me/impersonation")
      .then((r) => setState(r.impersonating && r.realUser ? { realUser: r.realUser } : null))
      // A failure here must not break the page. It does mean the banner is
      // absent, which is why the server refuses credential changes in an
      // impersonated session rather than relying on this being visible.
      .catch(() => setState(null));
  }, []);

  if (!state) return null;

  const stop = async () => {
    setLeaving(true);
    try {
      await api.post("/admin/impersonate/stop");
    } finally {
      // The impersonation token cannot become their own again, so the only
      // honest end is to clear it and sign in. Done even if the call failed —
      // discarding the token is what actually ends the session.
      tokens.clear();
      window.location.assign("/");
    }
  };

  return (
    <div className="impersonation-banner" role="status">
      <span>
        <strong>You are acting as another user.</strong> Signed in as{" "}
        {state.realUser.fullName}. This ends by itself and cannot be extended;
        everything you do is recorded against your name.
      </span>
      <button className="btn btn-quiet" onClick={stop} disabled={leaving}>
        {leaving ? "Stopping…" : "Stop"}
      </button>
    </div>
  );
}
