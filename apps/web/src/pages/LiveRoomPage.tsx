import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ConnectionStateToast,
  LiveKitRoom,
  VideoConference,
  usePreviewTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import type { LocalVideoTrack } from "livekit-client";
import "@livekit/components-styles";

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
 * NO SESSION AUTH HERE, deliberately. The token in the query string was minted
 * by the API only after it checked the caller's identity, their enrolment in
 * the section, and the join window (FR-LIV-006/007). It is scoped to one room,
 * one participant identity and a fixed lifetime, so it IS the authorisation.
 * Re-checking a login inside the frame would add nothing and would break the
 * frame for anybody whose access token rotated mid-class.
 */

interface JoinEnvelope {
  url: string;
  jwt: string;
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
    return { url: parsed.url, jwt: parsed.jwt };
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
        {/* Grid, speaker focus, screen share, chat and the control bar. The
            prefab rather than the pieces: this is a lesson, not a product
            surface, and the prefab is the part LiveKit maintains. */}
        <VideoConference />
        {/* Says "reconnecting" instead of freezing silently — on a patchy
            connection this is the difference between waiting and giving up. */}
        <ConnectionStateToast />
        <FullscreenButton />
      </LiveKitRoom>
    </div>
  );
}

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
    () => tracks?.find((t): t is LocalVideoTrack => t.kind === Track.Kind.Video),
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
 * The class, filling the screen.
 *
 * The classroom renders inside a 16:9 frame on a page that also carries a
 * sidebar and a topbar, which is right for glancing at a lesson and wrong for
 * following one. The iframe carries `allow="fullscreen"`, so this works from
 * inside it.
 */
function FullscreenButton() {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    // Failure is silent by design: some browsers and embedded webviews refuse
    // fullscreen outright, and an error dialog over a live lesson helps nobody.
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <button type="button" className="room-fullscreen" onClick={toggle}>
      {full ? "Exit full screen" : "Full screen"}
    </button>
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
