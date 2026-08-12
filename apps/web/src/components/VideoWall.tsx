import { useState } from "react";
import { Icon } from "./Icon";

export interface VideoLink {
  url: string;
  provider: "youtube" | "tiktok" | "facebook" | "instagram" | "other";
  id: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  portrait: boolean;
}

const LABEL: Record<VideoLink["provider"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  other: "Watch",
};

/**
 * The Institute's videos, from wherever it posts them.
 *
 * NOTHING LOADS UNTIL SOMEBODY PRESSES PLAY, and that is the whole design of
 * this component rather than a refinement of it. An embedded YouTube or TikTok
 * frame runs the provider's scripts and sets their cookies the moment the page
 * renders — on a public page reached by sixteen-year-olds searching for a
 * diploma, before anyone has chosen to watch anything. Six autoloading frames
 * also cost several megabytes and a second of blocking work on the phones most
 * applicants arrive on.
 *
 * So each card is a poster and a play button. The iframe is created on click,
 * for that one video, and YouTube is embedded through youtube-nocookie.
 *
 * A LINK IT COULD NOT READ IS STILL SHOWN, as a link. An administrator who
 * pasted something meant to publish it, and a silently vanishing row would send
 * them to check a setting that is saved and correct.
 */
export function VideoWall({ videos }: { videos: VideoLink[] }) {
  const [playing, setPlaying] = useState<string | null>(null);

  if (videos.length === 0) return null;

  return (
    <section className="landing-inner video-wall" id="videos">
      <header className="page-head">
        <div>
          <h2 className="landing-h2">See what we do</h2>
          <p className="muted">
            Straight from our own channels. Nothing plays until you press it.
          </p>
        </div>
      </header>

      <div className="video-grid">
        {videos.map((v) => {
          const isPlaying = playing === v.url;

          if (!v.embedUrl) {
            return (
              <a
                key={v.url}
                className="video-card video-card-link"
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="video-face">
                  <Icon name="play" className="video-play" />
                </span>
                <span className="video-meta">
                  <strong>Watch on {LABEL[v.provider]}</strong>
                  <span className="muted small">Opens in a new tab</span>
                </span>
              </a>
            );
          }

          return (
            <div
              key={v.url}
              className={`video-card${v.portrait ? " video-portrait" : ""}`}
            >
              {isPlaying ? (
                <iframe
                  className="video-frame"
                  src={`${v.embedUrl}${v.embedUrl.includes("?") ? "&" : "?"}autoplay=1`}
                  title={`${LABEL[v.provider]} video`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <button
                  type="button"
                  className="video-face"
                  onClick={() => setPlaying(v.url)}
                  aria-label={`Play this ${LABEL[v.provider]} video`}
                  style={
                    v.thumbnailUrl
                      ? { backgroundImage: `url("${v.thumbnailUrl}")` }
                      : undefined
                  }
                >
                  {/* Drawn, not fetched. TikTok gives no still without an API
                      call, and a grey rectangle reads as a broken image. */}
                  {!v.thumbnailUrl && <span className="video-pattern" aria-hidden="true" />}
                  <span className="video-play-ring">
                    <Icon name="play" className="video-play" />
                  </span>
                  <span className={`video-badge video-badge-${v.provider}`}>
                    {LABEL[v.provider]}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The Institute's channels, shown only where one is actually set. */
export function SocialRow({
  social,
}: {
  social: { platform: string; url: string }[];
}) {
  if (social.length === 0) return null;
  return (
    <div className="social-row">
      {social.map((s) => (
        <a
          key={s.platform}
          className={`social-link social-${s.platform}`}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name={s.platform} />
          <span className="visually-hidden">
            {s.platform.charAt(0).toUpperCase() + s.platform.slice(1)}
          </span>
        </a>
      ))}
    </div>
  );
}
