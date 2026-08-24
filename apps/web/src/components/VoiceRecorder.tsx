import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * RECORD A VOICE NOTE IN THE BROWSER — one component, both directions.
 *
 * A teacher records the brief for an assignment; a student records their answer
 * to it. The act is identical, so the control is, and the only difference is
 * what the caller does with the blob it hands back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS WORTH HAVING AT ALL. For design and language work, speech carries
 * what text cannot: a tutor explaining what is wrong with a layout says it in
 * forty seconds and says it better than in four paragraphs, and a student
 * practising English needs to be HEARD rather than read. Typing loses the
 * emphasis, and the emphasis is the point.
 *
 * THE FORMAT IS NOT A CHOICE ANYBODY MAKES. Chrome, Edge and Firefox record
 * webm/Opus; Safari and every iPhone record mp4/AAC. The recorder asks for the
 * first type the browser admits to supporting and the server accepts all of
 * them, because half a cohort in Pakistan is on an iPhone and the other half is
 * not.
 *
 * PERMISSION IS ASKED FOR WHEN THE BUTTON IS PRESSED, never on mount. A page
 * that pops a microphone prompt the moment it loads is one people refuse out of
 * reflex — and once refused, the browser remembers, so the feature is dead for
 * that person until they go into site settings. The prompt has to arrive
 * attached to an obvious intention.
 *
 * THE STREAM IS STOPPED THE MOMENT RECORDING ENDS. A MediaStream left open
 * holds the microphone, and the browser shows a recording indicator for as long
 * as it does — on a laptop that is a red dot in the tab saying the Institute is
 * listening to you, which is both untrue and unforgivable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** In the order we would prefer them; the browser picks the first it knows. */
const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function supportedType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** "0:42", because a duration is read at a glance and never calculated. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface Recording {
  blob: Blob;
  seconds: number;
  /** The container the browser chose, without codec parameters. */
  contentType: string;
}

export function VoiceRecorder({
  label = "Voice note",
  hint,
  maxSeconds = 300,
  busy = false,
  onRecorded,
  onDiscard,
}: {
  label?: string;
  hint?: string;
  /** A ceiling, enforced by stopping rather than by refusing afterwards. */
  maxSeconds?: number;
  /** The caller is uploading; the controls lock rather than disappear. */
  busy?: boolean;
  onRecorded: (recording: Recording) => void;
  /** Called when the held recording is thrown away, so the caller can too. */
  onDiscard?: () => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef<number>(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<{ url: string; seconds: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const unsupported = typeof MediaRecorder === "undefined" || !supportedType();

  /** Everything that must happen however recording ended. */
  const release = useCallback(() => {
    if (tick.current) {
      clearInterval(tick.current);
      tick.current = null;
    }
    // The microphone, given back. See the note at the top of this file.
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  // A recording in progress when the page changes must not keep the microphone.
  useEffect(() => () => release(), [release]);

  // An object URL is a document-lifetime handle on the blob; without this every
  // re-take leaks one for as long as the tab is open.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview?.url]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = async () => {
    setProblem(null);
    const mimeType = supportedType();
    if (!mimeType) {
      setProblem("This browser cannot record audio. Try Chrome, Firefox or Safari.");
      return;
    }

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      /*
       * THE THREE REFUSALS ARE DIFFERENT PROBLEMS with different remedies, and
       * "could not access microphone" helps with none of them.
       */
      const name = e instanceof DOMException ? e.name : "";
      setProblem(
        name === "NotAllowedError"
          ? "The browser blocked the microphone. Allow it for this site — in the address bar, the padlock — then press record again."
          : name === "NotFoundError"
            ? "No microphone was found. Plug one in, or check it is not disabled in your system settings."
            : "The microphone could not be started. Another program may be using it.",
      );
      return;
    }

    stream.current = media;
    chunks.current = [];

    const mr = new MediaRecorder(media, { mimeType });
    recorder.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };

    mr.onstop = () => {
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      // Without the codec parameters: the server matches on the container, and
      // "audio/webm;codecs=opus" is not a content type it stores.
      const contentType = (mr.mimeType || mimeType).split(";")[0] ?? "audio/webm";
      const blob = new Blob(chunks.current, { type: contentType });
      release();
      setRecording(false);
      setSeconds(0);

      if (blob.size === 0) {
        setProblem("Nothing was recorded. Check the microphone is not muted.");
        return;
      }

      setPreview({ url: URL.createObjectURL(blob), seconds: elapsed });
      onRecorded({ blob, seconds: elapsed, contentType });
    };

    startedAt.current = Date.now();
    mr.start();
    setRecording(true);
    setSeconds(0);

    tick.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      // STOPPED AT THE CEILING rather than refused after the fact. Recording
      // for four minutes and being told the limit was three loses the take.
      if (elapsed >= maxSeconds) stop();
    }, 250);
  };

  const discard = () => {
    setPreview(null);
    setProblem(null);
    onDiscard?.();
  };

  if (unsupported) {
    return (
      <div className="voice-recorder">
        <span className="field-label">{label}</span>
        <p className="muted small">
          This browser cannot record audio, so there is nothing to show here. Everything else on
          this page works as usual.
        </p>
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      <span className="field-label">{label}</span>

      <div className="voice-row">
        {recording ? (
          <button type="button" className="btn btn-danger voice-stop" onClick={stop}>
            <Icon name="tick" />
            Stop
          </button>
        ) : (
          <button type="button" className="btn voice-start" disabled={busy} onClick={() => void start()}>
            <Icon name="megaphone" />
            {preview ? "Record again" : "Record"}
          </button>
        )}

        {recording && (
          <span className="voice-live" role="status">
            {/* A word beside the dot, never colour alone (NFR-ACC-007). */}
            <span className="voice-dot" aria-hidden="true" />
            Recording {clock(seconds)}
            <span className="muted small"> · up to {clock(maxSeconds)}</span>
          </span>
        )}

        {!recording && preview && (
          <>
            {/* No caption track, and none is possible: this is a recording
                the user made two seconds ago. The written instructions beside
                it are the text alternative, which is why they stay required. */}
            <audio className="voice-player" src={preview.url} controls preload="metadata" />
            <span className="muted small">{clock(preview.seconds)}</span>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={discard}>
              Discard
            </button>
          </>
        )}
      </div>

      {hint && !recording && <span className="muted small">{hint}</span>}

      {problem && (
        <div className="alert alert-error" role="alert">
          <p className="small">{problem}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Playback for a note already saved on the server.
 *
 * Separate from the recorder because it is a different act with different
 * anxieties: the recorder worries about permission and takes, this only has to
 * play something and say how long it is. It fetches through the API client so
 * the request carries the bearer token — an <audio src> pointing at a guarded
 * route sends no Authorization header and would answer 401.
 */
export function VoiceNote({
  src,
  seconds,
  label = "Spoken brief",
}: {
  /** An object URL the caller obtained; this component does not fetch. */
  src: string | null;
  seconds?: number | null;
  label?: string;
}) {
  if (!src) return null;
  return (
    <div className="voice-note">
      <span className="voice-note-mark" aria-hidden="true">
        <Icon name="megaphone" />
      </span>
      <div className="voice-note-body">
        <strong className="small">{label}</strong>
        {/* See the note on the recorder above: a voice note carries no
            caption track, and the written text beside it is the alternative. */}
        <audio className="voice-player" src={src} controls preload="metadata" />
      </div>
      {typeof seconds === "number" && seconds > 0 && (
        <span className="muted small">{clock(seconds)}</span>
      )}
    </div>
  );
}
