import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ConnectionStateToast,
  LiveKitRoom,
  VideoConference,
  useIsRecording,
  useParticipants,
  usePreviewTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { ApiError, api } from "../api/client";

/**
 * The classroom itself — the web half of the LiveKit adapter.
 *
 * ClassPage owns everything around a class: when it is, whether it has started,
 * the countdown, the register, the recording afterwards. It does not own the
 * video surface, and it does not know what a provider is. When the provider
 * answers EMBEDDED_ROUTE it puts `internalPath` in an iframe, and this page is
 * what loads there.
 *
 * That is why this file may name LiveKit and ClassPage may not: this page IS
 * the provider's surface, the way livekit.provider.ts is on the server. ARC-025
 * draws the line above both of them, and neither ClassPage nor any domain
 * module changed to add this.
 *
 * NO SESSION AUTH TO GET IN, deliberately. The token in the query string was
 * minted by the API only after it checked the caller's identity, their enrolment
 * in the section, and the join window (FR-LIV-006/007). It is scoped to one
 * room, one participant identity and a fixed lifetime, so it IS the
 * authorisation for the video.
 *
 * The moderation calls are a different matter and go through the ordinary API
 * with the ordinary permissions — a token that lets somebody into a room must
 * not also let them throw people out of it.
 */

interface JoinEnvelope {
  url: string;
  jwt: string;
  isHost: boolean;
  sessionId: string;
}

/**
 * Unwraps what livekit.provider.ts packed into `token`.
 *
 * The server URL travels with the JWT rather than in a build-time VITE_
 * variable, so the address of the classroom is configured in exactly one place
 * — the API's .env — and changing it does not need the web app rebuilt.
 */
function decodeEnvelope(raw: string | null): JoinEnvelope | null {
  if (!raw) return null;
  try {
    // base64url → base64. atob rejects "-" and "_", and rejects a value whose
    // length is not a multiple of four.
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const parsed = JSON.parse(atob(padded)) as Partial<JoinEnvelope>;
    if (typeof parsed.url !== "string" || typeof parsed.jwt !== "string") return null;
    if (!parsed.url || !parsed.jwt) return null;
    return {
      url: parsed.url,
      jwt: parsed.jwt,
      // Absent means student. A page that guessed "host" from a missing field
      // would show moderation controls to a class, and every one of them would
      // be refused by the API — which reads as the LMS being broken.
      isHost: parsed.isHost === true,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
    };
  } catch {
    return null;
  }
}

export function LiveRoomPage() {
  const [params] = useSearchParams();
  // Parsed once. Re-parsing on each render would rebuild the token string and
  // make LiveKitRoom reconnect, which drops everyone out of the class.
  const envelope = useMemo(() => decodeEnvelope(params.get("t")), [params]);

  if (!envelope) {
    return (
      <RoomMessage
        title="This classroom link is not valid."
        detail="Go back to the class and press Join again — the link is issued fresh each time."
      />
    );
  }
  // Every hook below this point lives in Classroom, so that this early return
  // cannot make the hook order differ between renders.
  return <Classroom envelope={envelope} />;
}

/** What the student chose on the way in. */
interface Choices {
  camera: boolean;
  microphone: boolean;
  cameraId?: string | undefined;
  microphoneId?: string | undefined;
}

function Classroom({ envelope }: { envelope: JoinEnvelope }) {
  const [joined, setJoined] = useState<Choices | null>(null);
  const [left, setLeft] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (failure) {
    return (
      <RoomMessage
        title="The classroom could not be reached."
        detail={failure}
        hint="Check your connection and press Join again. If it keeps happening, tell your teacher — they can hold the class on a fallback link."
      />
    );
  }

  if (left) {
    return (
      <RoomMessage
        title="You have left the class."
        detail="Your attendance was recorded when you joined."
        action={{ label: "Rejoin the class", onClick: () => setLeft(false) }}
      />
    );
  }

  if (!joined) return <PreJoin onJoin={setJoined} />;

  return (
    <div className="live-room" data-lk-theme="default">
      <LiveKitRoom
        serverUrl={envelope.url}
        token={envelope.jwt}
        connect={true}
        // What the student actually chose on the pre-join screen, rather than
        // switching the camera on for them and letting them find out afterwards.
        video={joined.camera ? { deviceId: joined.cameraId } : false}
        audio={joined.microphone ? { deviceId: joined.microphoneId } : false}
        onDisconnected={() => setLeft(true)}
        onError={(err) => setFailure(err.message)}
        style={{ height: "100%" }}
      >
        {/* Grid, speaker focus, screen share, chat, and the camera and
            microphone controls along the bottom. The prefab rather than the
            pieces: this is a lesson, not a product surface, and the prefab is
            the part LiveKit maintains. */}
        <VideoConference />
        {/* Says "reconnecting" instead of freezing silently — on a patchy
            connection this is the difference between waiting and giving up. */}
        <ConnectionStateToast />
        <RoomChrome isHost={envelope.isHost} sessionId={envelope.sessionId} />
      </LiveKitRoom>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  In-class chrome: who is here, inviting, full screen                        */
/* -------------------------------------------------------------------------- */

/**
 * WHAT THE TEACHER GETS THAT THE STUDENT DOES NOT.
 *
 * Both see who is in the room — a student wanting to know whether the class has
 * filled up is asking a reasonable question, and every conferencing tool answers
 * it. Only the teacher sees mute and remove, and that is not merely hidden: the
 * endpoints behind them require live_session:update, which a student does not
 * hold at any scope. The interface and the permission agree.
 */
function RoomChrome({ isHost, sessionId }: { isHost: boolean; sessionId: string }) {
  const participants = useParticipants();
  /*
   * FROM LIVEKIT, NOT FROM OUR API, and that is what makes it honest.
   *
   * Everybody in the room has to be able to see that they are being recorded —
   * it is the difference between a lesson and a lesson somebody is keeping, and
   * in many places it is also the law. Our recording endpoints need
   * live_session:update, which a student does not hold, so a student polling
   * them would learn nothing.
   *
   * LiveKit publishes the room's recording state to every participant. This
   * reads that, so the badge cannot disagree with reality and cannot be hidden
   * by anybody's permissions.
   */
  const isRecording = useIsRecording();
  const [panel, setPanel] = useState<"none" | "people" | "invite">("none");
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  /** FR-VID — start or stop, never a toggle. See the endpoints. */
  const record = useCallback(
    async (start: boolean) => {
      if (!start && !window.confirm("Stop recording this class?")) return;
      setRecBusy(true);
      setNote(null);
      try {
        await api.post(`/live-sessions/${sessionId}/recording/${start ? "start" : "stop"}`);
        // Deliberately says the file is not ready. Encoding continues after the
        // room closes, and a teacher who goes looking immediately and finds
        // nothing concludes it failed.
        setNote(start ? "Recording." : "Stopped. The lecture appears once it has finished encoding.");
      } catch (e) {
        setNote(e instanceof ApiError ? e.message : "The recorder did not respond.");
      } finally {
        setRecBusy(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    // Failure is silent by design: some browsers and embedded webviews refuse
    // fullscreen outright, and an error dialog over a live lesson helps nobody.
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  /**
   * Muting and removing go through the API, not the room.
   *
   * They have to: LiveKit only accepts these from a server holding the API
   * secret, and the browser must never hold that. It also means the ordinary
   * permission check applies, and the act lands in the audit log — acting on
   * somebody in front of a class is the kind of thing that gets disputed later.
   */
  const act = useCallback(
    async (identity: string, what: "audio" | "video" | "remove", who: string) => {
      if (what === "remove" && !window.confirm(`Remove ${who} from the class?`)) return;
      setBusy(identity + what);
      setNote(null);
      try {
        if (what === "remove") {
          await api.post(`/live-sessions/${sessionId}/participants/${identity}/remove`);
          setNote(`${who} was removed.`);
        } else {
          await api.post(`/live-sessions/${sessionId}/participants/${identity}/mute`, {
            kind: what,
          });
          setNote(`${who} was muted.`);
        }
      } catch (e) {
        setNote(e instanceof ApiError ? e.message : "That did not work.");
      } finally {
        setBusy(null);
      }
    },
    [sessionId],
  );

  return (
    <>
      {/* Seen by EVERYONE in the room, teacher and student alike. Being
          recorded is not something to discover afterwards. */}
      {isRecording && (
        <div className="room-recording" role="status">
          <span className="room-recording-dot" aria-hidden="true" />
          Recording
        </div>
      )}

      <div className="room-bar">
        {isHost && (
          <button
            type="button"
            className={`room-bar-btn ${isRecording ? "is-recording" : ""}`}
            disabled={recBusy}
            onClick={() => void record(!isRecording)}
          >
            {recBusy ? "Working…" : isRecording ? "Stop recording" : "Record"}
          </button>
        )}
        <button
          type="button"
          className={`room-bar-btn ${panel === "people" ? "is-on" : ""}`}
          aria-pressed={panel === "people"}
          onClick={() => setPanel((p) => (p === "people" ? "none" : "people"))}
        >
          People <span className="room-count">{participants.length}</span>
        </button>
        {/* Sharing the way in is the teacher's job. A student passing the class
            link around is not useful — the page behind it refuses anybody not
            enrolled — and offering it to them implies otherwise. */}
        {isHost && (
          <button
            type="button"
            className={`room-bar-btn ${panel === "invite" ? "is-on" : ""}`}
            aria-pressed={panel === "invite"}
            onClick={() => setPanel((p) => (p === "invite" ? "none" : "invite"))}
          >
            Invite
          </button>
        )}
        <button type="button" className="room-bar-btn" onClick={toggleFullscreen}>
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      {panel === "people" && (
        <aside className="room-panel" aria-label="People in this class">
          <header className="room-panel-head">
            <span>In the class · {participants.length}</span>
            <button type="button" className="room-panel-close" onClick={() => setPanel("none")}>
              Close
            </button>
          </header>

          <ul className="room-people">
            {participants.map((p) => {
              const who = p.name || p.identity;
              return (
                <li key={p.identity} className="room-person">
                  <div className="room-person-who">
                    <span className="room-person-name">
                      {who}
                      {p.isLocal && <span className="room-person-you"> (you)</span>}
                    </span>
                    {/* Words, not only icons: "muted" is a fact a screen reader
                        has to be able to read out. */}
                    <span className="room-person-state">
                      {p.isMicrophoneEnabled ? "microphone on" : "muted"}
                      {" · "}
                      {p.isCameraEnabled ? "camera on" : "camera off"}
                    </span>
                  </div>

                  {isHost && !p.isLocal && (
                    <div className="room-person-actions">
                      {/* Offered only where there is something to switch off.
                          A mute button on somebody already muted does nothing
                          and teaches people the buttons are unreliable. */}
                      {p.isMicrophoneEnabled && (
                        <button
                          type="button"
                          className="room-mini"
                          disabled={busy === p.identity + "audio"}
                          onClick={() => void act(p.identity, "audio", who)}
                        >
                          Mute
                        </button>
                      )}
                      {p.isCameraEnabled && (
                        <button
                          type="button"
                          className="room-mini"
                          disabled={busy === p.identity + "video"}
                          onClick={() => void act(p.identity, "video", who)}
                        >
                          Camera off
                        </button>
                      )}
                      <button
                        type="button"
                        className="room-mini room-mini-warn"
                        disabled={busy === p.identity + "remove"}
                        onClick={() => void act(p.identity, "remove", who)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {isHost && (
            /* Said once, in the panel, rather than discovered by pressing a
               button that is not there: a teacher looking for "unmute" needs to
               know it is a decision and not an oversight. */
            <p className="room-panel-note">
              You can mute someone, but not switch their microphone or camera back
              on — only they can do that.
            </p>
          )}
          {note && <p className="room-panel-note room-panel-said">{note}</p>}
        </aside>
      )}

      {panel === "invite" && <InvitePanel sessionId={sessionId} onClose={() => setPanel("none")} />}
    </>
  );
}

/**
 * Sharing the way in.
 *
 * The link is to the CLASS PAGE, never to the room. The class page is what
 * checks enrolment and the join window and records attendance; a link straight
 * into the video would skip all three, and the token in it would work for
 * anybody who was sent it.
 *
 * So this is safe to paste into a group chat: somebody not enrolled who opens
 * it is refused, and somebody enrolled gets a proper join with a register entry.
 */
function InvitePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const link = `${window.location.origin}/classes/${sessionId}`;
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /*
       * The clipboard API needs a secure context and a permission, and refuses
       * inside some embedded webviews. Selecting the text is the fallback that
       * always works — the teacher presses Ctrl-C, which is one key more than
       * they hoped for and infinitely better than a button that does nothing.
       */
      field.current?.select();
    }
  };

  return (
    <aside className="room-panel" aria-label="Invite someone to this class">
      <header className="room-panel-head">
        <span>Invite</span>
        <button type="button" className="room-panel-close" onClick={onClose}>
          Close
        </button>
      </header>

      <p className="room-panel-note">
        Send this to anybody on the class list. It opens the class page, which takes
        the register as they come in.
      </p>

      <input ref={field} className="room-invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />

      <button type="button" className="btn btn-primary room-invite-copy" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy the link"}
      </button>

      <p className="room-panel-note">
        Students enrolled in this class already see it on their dashboard the
        moment it starts — this is for nudging somebody who has not noticed.
      </p>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*  Before the class                                                          */
/* -------------------------------------------------------------------------- */

/**
 * THE SCREEN BEFORE THE CLASS, and the one that earns its place.
 *
 * Dropping a student straight into a lesson is how somebody spends ten minutes
 * on the wrong microphone, or joins on camera when they did not mean to, in
 * front of the whole class. They see themselves here first, pick their devices,
 * and decide — before anybody else can see or hear them.
 *
 * Built from the hooks rather than the PreJoin prefab, which asks for a display
 * name. The name is already in the token, and a box asking a student to type
 * their own name into their own institution's LMS invites them to type
 * something else.
 */
function PreJoin({ onJoin }: { onJoin: (c: Choices) => void }) {
  const [camera, setCamera] = useState(true);
  const [microphone, setMicrophone] = useState(true);
  const [cameraId, setCameraId] = useState<string | undefined>(undefined);
  const [microphoneId, setMicrophoneId] = useState<string | undefined>(undefined);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const onError = useCallback((e: Error) => setDeviceError(e.message), []);
  const tracks = usePreviewTracks(
    {
      video: camera ? { deviceId: cameraId } : false,
      audio: microphone ? { deviceId: microphoneId } : false,
    },
    onError,
  );

  const videoTrack = useMemo(
    // The enum, not the string it happens to equal — Track.Kind is a real enum
    // and comparing it to a literal is how this silently stops matching.
    () => tracks?.find((t) => t.kind === Track.Kind.Video),
    [tracks],
  );

  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = preview.current;
    if (!videoTrack || !el) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  /*
   * Enumerated only AFTER a track exists.
   *
   * A browser hides device LABELS until the page holds a media permission, so
   * listing them any earlier gives a menu of blank entries called "Camera 1"
   * and "Camera 2" — which is worse than no menu, because it looks like the
   * feature is broken rather than not ready.
   */
  useEffect(() => {
    if (!tracks?.length) return;
    let cancelled = false;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        if (cancelled) return;
        setCameras(all.filter((d) => d.kind === "videoinput" && d.label));
        setMicrophones(all.filter((d) => d.kind === "audioinput" && d.label));
      })
      .catch(() => {
        /* A device list is a convenience; failing to build one is not fatal. */
      });
    return () => {
      cancelled = true;
    };
  }, [tracks]);

  return (
    <div className="live-room live-prejoin" data-lk-theme="default">
      <div className="prejoin-card">
        <div className="prejoin-preview">
          {camera ? (
            // Muted and playsInline: a self-preview that played its own audio
            // would howl, and iOS refuses to play inline video without it.
            <video ref={preview} autoPlay muted playsInline />
          ) : (
            <div className="prejoin-camera-off">
              <p>Your camera is off.</p>
              <p className="prejoin-sub">The class will see your name only.</p>
            </div>
          )}
        </div>

        <div className="prejoin-controls">
          <p className="prejoin-title">Ready to join?</p>
          <p className="prejoin-sub">
            Check how you look and sound. You can change either of these once you are in.
          </p>

          <div className="prejoin-toggles">
            <button
              type="button"
              className={`btn btn-sm ${camera ? "btn-primary" : "btn-quiet"}`}
              aria-pressed={camera}
              onClick={() => setCamera((v) => !v)}
            >
              {camera ? "Camera on" : "Camera off"}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${microphone ? "btn-primary" : "btn-quiet"}`}
              aria-pressed={microphone}
              onClick={() => setMicrophone((v) => !v)}
            >
              {microphone ? "Microphone on" : "Microphone off"}
            </button>
          </div>

          {/* Only offered where there is a choice to make. A select with one
              option is furniture. */}
          {camera && cameras.length > 1 && (
            <label className="prejoin-device">
              <span>Camera</span>
              <select value={cameraId ?? ""} onChange={(e) => setCameraId(e.target.value || undefined)}>
                {cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {microphone && microphones.length > 1 && (
            <label className="prejoin-device">
              <span>Microphone</span>
              <select
                value={microphoneId ?? ""}
                onChange={(e) => setMicrophoneId(e.target.value || undefined)}
              >
                {microphones.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {deviceError && (
            /*
             * NOT A BLOCKER, and that is the point. The usual cause is a denied
             * permission or a camera another application is holding. A student
             * in that position still has a lesson to attend, so they are told
             * what happened and the join button stays live — they can go in and
             * listen.
             */
            <p className="prejoin-warn">
              We could not reach your camera or microphone. You can still join and listen.
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary prejoin-join"
            onClick={() => onJoin({ camera, microphone, cameraId, microphoneId })}
          >
            Join the class
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Every non-video state, in one shape.
 *
 * This renders INSIDE the iframe on the class page, so it has to stand on its
 * own — the surrounding page cannot see that anything went wrong, and a blank
 * frame would leave a student with nothing to act on.
 */
function RoomMessage({
  title,
  detail,
  hint,
  action,
}: {
  title: string;
  detail: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="live-room live-room-message">
      <div>
        <p className="live-room-title">{title}</p>
        <p className="live-room-detail">{detail}</p>
        {hint && <p className="live-room-hint">{hint}</p>}
        {action && (
          <button type="button" className="btn btn-primary live-room-action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
