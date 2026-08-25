import { useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "./Icon";

/**
 * THE CLASS'S MEETING ROOM — FR-LIV.
 *
 * One link per class, used every week. Google Meet, Zoom, Teams: the System
 * does not care which, and deliberately — an Institute that changes provider
 * next term changes a string, not a feature.
 *
 * IT BELONGS TO THE SUBJECT INSIDE THE SECTION, not to the subject. Two
 * sections of the same course are two different classes meeting in two
 * different rooms at two different times, and a link on the course would send
 * both to the same one. That is why this takes a sectionSubjectId.
 *
 * WHAT THIS REPLACES is the link pasted into WhatsApp every week, which every
 * student has to scroll back through a group chat to find, and which the
 * student who joined in week three never received at all.
 *
 * THE STUDENT'S HALF IS A LINK, NOT A BUTTON THAT NAVIGATES. It opens in a new
 * tab with `rel="noreferrer"`: the room is somebody else's site, and the tab it
 * opens should not be handed a reference back into a signed-in session.
 */

export function ClassRoom({
  sectionSubjectId,
  meetingUrl,
  meetingNote,
  canManage = false,
  onSaved,
}: {
  sectionSubjectId: string;
  meetingUrl: string | null;
  meetingNote?: string | null;
  /** Teacher on their own class, or the office on any. Shows the editor. */
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);

  // Nothing set and nobody who can set it: say nothing at all. A permanent
  // "no meeting link" line on every class in a room-taught Institute is a
  // sentence on every screen that never becomes true.
  if (!meetingUrl && !canManage) return null;

  return (
    <div className="class-room">
      {meetingUrl ? (
        <div className="class-room-live">
          <Icon name="monitor" />
          <div className="class-room-text">
            <a
              className="btn btn-primary"
              href={meetingUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Join the class
            </a>
            {meetingNote && <p className="small">{meetingNote}</p>}
            {canManage && (
              <p className="muted small">
                Everyone in this class sees this button. <code>{shortUrl(meetingUrl)}</code>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="muted small">
          <Icon name="monitor" /> No meeting link for this class yet. Set one and every student sees
          it here, every week, without being sent it again.
        </p>
      )}

      {canManage &&
        (editing ? (
          <RoomEditor
            sectionSubjectId={sectionSubjectId}
            meetingUrl={meetingUrl}
            meetingNote={meetingNote ?? null}
            onDone={(changed) => {
              setEditing(false);
              if (changed) onSaved?.();
            }}
          />
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
            {meetingUrl ? "Change the link" : "Set the meeting link"}
          </button>
        ))}
    </div>
  );
}

function RoomEditor({
  sectionSubjectId,
  meetingUrl,
  meetingNote,
  onDone,
}: {
  sectionSubjectId: string;
  meetingUrl: string | null;
  meetingNote: string | null;
  onDone: (changed: boolean) => void;
}) {
  const [url, setUrl] = useState(meetingUrl ?? "");
  const [note, setNote] = useState(meetingNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/section-subjects/${sectionSubjectId}/meeting-link`, {
        meetingUrl: url.trim(),
        note: note.trim() || undefined,
      });
      onDone(true);
    } catch (e) {
      /*
       * THE DETAILS, NOT THE TOP-LINE MESSAGE.
       *
       * The server refuses an `http://` link and says why — the address of a
       * room handed over an unencrypted connection is the address of a room
       * anybody on the same café wifi can read. That sentence is in the
       * envelope's `details`; the top-level message on a validation failure is
       * the generic "The submitted data could not be accepted", which tells a
       * teacher staring at a pasted link precisely nothing (NFR-USE-007).
       */
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That link could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="class-room-editor">
      <label className="field">
        <span>The meeting link</span>
        <input
          type="url"
          value={url}
          placeholder="https://meet.google.com/abc-defg-hij"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {/* Said before it is refused rather than after. A teacher who pastes what
          their browser shows them — which often omits the scheme — should not
          have to learn the rule from an error. */}
      <p className="muted small">
        Paste the whole address, including the <code>https://</code> at the front. Any provider
        works. Clearing the box removes the link.
      </p>

      <label className="field">
        <span>Anything they should know (optional)</span>
        <input
          type="text"
          value={note}
          placeholder="Join five minutes early — the passcode is in the notice."
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-quiet" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Enough of the link to recognise, not enough to fill the line.
 *
 * Shown to staff only, so they can confirm at a glance that the class points
 * at the room they meant rather than last term's.
 */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}
