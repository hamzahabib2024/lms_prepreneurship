import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useDismissable } from "./useDismissable";

/**
 * The inbox — SRS §13.2, FR-COM-014/015.
 *
 * Polls rather than holding a socket open. A count that is a minute stale costs
 * nothing here, and a WebSocket would need connection state, reconnection and a
 * second authentication path for a badge — see ARC-049, which permits the cache
 * to be absent and by the same reasoning permits this.
 *
 * Opening a notification marks it read and goes where it points, because a
 * notification exists to get somebody somewhere.
 */

interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InboxItem[]>([]);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api
      .get<{ unread: number; items: InboxItem[] }>("/me/notifications?limit=20")
      .then((r) => {
        setUnread(r.unread);
        setItems(r.items);
      })
      // A failing badge must not put an error banner over the whole
      // application. The inbox is not why anyone is here.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  /*
   * CLICK AWAY AND IT CLOSES — which it did not, and the account menu six
   * pixels to its right always did. Opening the inbox and then clicking
   * anywhere else left it hanging over the page, and the only way out was to
   * find the Inbox button again and press it a second time.
   */
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, { wrap, trigger });

  const openItem = async (item: InboxItem) => {
    if (!item.readAt) {
      await api.patch("/me/notifications/read", { notificationIds: [item.id] }).catch(() => undefined);
    }
    setOpen(false);
    load();
    if (item.linkPath) navigate(item.linkPath);
  };

  const markAll = async () => {
    await api.post("/me/notifications/read-all").catch(() => undefined);
    load();
  };

  return (
    <div className="bell" ref={wrap}>
      <button
        ref={trigger}
        className="btn btn-quiet"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        // The count is in the label, not only in a coloured dot — a screen
        // reader gets the same information as everyone else (NFR-ACC-002).
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        Inbox{unread > 0 && <span className="badge">{unread}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="modal-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="btn btn-quiet" onClick={() => void markAll()}>
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            <ul className="list">
              {items.map((n) => (
                <li key={n.id} className={n.readAt ? "done" : ""}>
                  <button className="link-button" onClick={() => void openItem(n)}>
                    <span>{n.title}</span>
                    <br />
                    <span className="muted small">{n.body}</span>
                    <br />
                    <span className="muted small">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
