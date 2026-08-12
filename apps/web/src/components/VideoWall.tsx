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

export interface ImageLink {
  url: string;
  alt: string;
}

/**
 * Photographs of the Institute.
 *
 * A BROKEN IMAGE REMOVES ITSELF. These are links to somewhere else — a CDN, a
 * Drive folder, a site that reorganised last month — and the failure mode of a
 * gallery is a grid of broken-image icons, which says "nobody looks at this
 * page" more loudly than an empty section ever could. On error the tile is
 * dropped and the grid closes over it.
 *
 * `loading="lazy"` because a gallery below three other sections should not
 * cost a visitor on a phone anything until they scroll to it.
 */
export function PhotoStrip({ images }: { images: ImageLink[] }) {
  const [broken, setBroken] = useState<string[]>([]);
  const usable = images.filter((i) => !broken.includes(i.url));

  if (usable.length === 0) return null;

  return (
    <section className="landing-inner photo-strip">
      <div className="photo-grid">
        {usable.map((img) => (
          <figure key={img.url} className="photo-tile">
            <img
              src={img.url}
              alt={img.alt}
              loading="lazy"
              onError={() => setBroken((b) => [...b, img.url])}
            />
            {/* Only where there is something to say. An empty caption bar
                under every picture is furniture. */}
            {img.alt && <figcaption>{img.alt}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  isPinned: boolean;
}

/**
 * The Institute's news — real announcements it chose to publish.
 *
 * The body is TRUNCATED rather than rendered in full. An announcement written
 * for students can run to several paragraphs, and six of those turn a front
 * page into a noticeboard nobody reads. What a stranger needs is that the
 * Institute is active and what it is currently saying.
 */
export function NewsList({ news }: { news: NewsItem[] }) {
  if (news.length === 0) return null;

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  return (
    <section className="landing-inner news-section" id="news">
      <header className="page-head">
        <div>
          <h2 className="landing-h2">Latest from the Institute</h2>
          <p className="muted">Notices we have published for everyone.</p>
        </div>
      </header>

      <div className="news-grid">
        {news.map((n) => (
          <article className="news-card" key={n.id}>
            {n.isPinned && <span className="pill pill-warn news-pin">Pinned</span>}
            <time className="news-date" dateTime={n.publishedAt}>
              {when(n.publishedAt)}
            </time>
            <h3>{n.title}</h3>
            <p>{n.body.length > 220 ? `${n.body.slice(0, 220).trimEnd()}…` : n.body}</p>
          </article>
        ))}
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
