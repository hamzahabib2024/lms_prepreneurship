import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "./Icon";
import { VoiceNote, VoiceRecorder, type Recording } from "./VoiceRecorder";

/**
 * THE MARKER'S OWN VOICE ON ONE STUDENT'S WORK — FR-ASG-027.
 *
 * WHY IT IS WORTH THE SCREEN SPACE. For design and language work a teacher
 * says in forty seconds what takes ten minutes to write, and says it better:
 * tone carries encouragement a written line cannot, and "this bit here" spoken
 * over a drawing is clearer than any description of where it is. Teachers
 * already record a spoken BRIEF for the same reason; this is the answering
 * half of it.
 *
 * IT IS OPTIONAL AND IT NEVER REPLACES THE WRITTEN FEEDBACK, and the hint says
 * so rather than leaving it implied. A recording is unusable to a deaf
 * student, unsearchable, and unreadable on a metered connection — so a teacher
 * who records instead of writing has made the mark worse for the student who
 * can least afford it.
 *
 * IT REACHES THE STUDENT IMMEDIATELY, like the written comment thread — and
 * it needs no mark first. Gating it on a saved grade hid the recorder on
 * exactly the student a teacher most wants to talk to: the one whose work
 * cannot be marked as it stands. The panel says plainly that it has already
 * gone, so nobody has to wonder.
 */
export function FeedbackVoice({
  submissionId,
  hasRecording,
  seconds,
  onChanged,
}: {
  submissionId: string;
  hasRecording: boolean;
  seconds: number | null;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  // An object URL outlives the component unless it is revoked, and a marker
  // works through thirty of these in a sitting.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  // A new student is a new recording; drop whatever was loaded for the last.
  useEffect(() => {
    setUrl(null);
    setReplacing(false);
    setError(null);
  }, [submissionId]);

  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.download(`/submissions/${submissionId}/feedback-audio`);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That recording could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (recording: Recording) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      // Named with the container's extension so the server's signature check
      // and the browser's own idea of the file agree.
      form.append("file", recording.blob, `feedback.${recording.contentType.includes("mp4") ? "m4a" : "webm"}`);
      form.append("seconds", String(recording.seconds));
      await api.upload(`/submissions/${submissionId}/feedback-audio`, form);
      setReplacing(false);
      setUrl(null);
      onChanged();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That recording could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/submissions/${submissionId}/feedback-audio`);
      setUrl(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That recording could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span className="field-label">Spoken feedback (optional)</span>

      {error && (
        <div className="alert alert-error" role="alert">
          <p className="small">{error}</p>
        </div>
      )}

      {hasRecording && !replacing ? (
        <>
          {url ? (
            <VoiceNote src={url} seconds={seconds} label="Your spoken feedback" />
          ) : (
            <div className="voice-note">
              <span className="voice-note-mark" aria-hidden="true">
                <Icon name="megaphone" />
              </span>
              <div className="voice-note-body">
                <strong className="small">
                  You recorded {seconds ? `${seconds} seconds` : "a note"} for this student
                </strong>
                <span className="muted small">
                  They can hear this now — it does not wait for the grades to be released.
                </span>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => void play()} disabled={busy}>
                {busy ? "Loading…" : "Play"}
              </button>
            </div>
          )}

          <div className="row-actions">
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setReplacing(true)}
              disabled={busy}
            >
              Record again
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => void remove()}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <VoiceRecorder
            label="Say it instead of typing it"
            hint="A minute or two for this one student. They hear it straight away, without waiting for the grades. It is an addition to the written feedback and never a replacement — a recording is no use to a deaf student and cannot be searched."
            maxSeconds={300}
            busy={busy}
            onRecorded={(r) => void upload(r)}
            {...(replacing ? { onDiscard: () => setReplacing(false) } : {})}
          />
          {replacing && (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setReplacing(false)}
              disabled={busy}
            >
              Keep the one I have
            </button>
          )}
        </>
      )}
    </div>
  );
}
