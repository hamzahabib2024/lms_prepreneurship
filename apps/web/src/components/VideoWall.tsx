import { useState } from "react";
import { Icon } from "./Icon";
import { useAutoRotate } from "./useAutoRotate";

export interface VideoLink {
  url: string;
  provider: "youtube" | "tiktok" | "facebook" | "instagram" | "other";
  id: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  portrait: boolean;
  /**
   * The shape of the thing, as a CSS aspect-ratio the server worked out from
   * the URL. Optional so an older API that only sends `portrait` still renders
   * — falling back to the two shapes it knows about rather than to nothing.
   */
  aspect?: string;
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
export function VideoWall({
  videos,
  /*
   * THE HEADING IS THE INSTITUTE'S, NOT THIS COMPONENT'S.
   *
   * It was a literal here, which meant an institute that does not think of its
   * channels as "what we do" could not say otherwise without a deployment. The
   * defaults are the words that were here, so a caller that passes nothing
   * renders exactly what this component rendered before.
   */
  heading = "See what we do",
  blurb = "Straight from our own channels. Nothing plays until you press it.",
}: {
  videos: VideoLink[];
  heading?: string;
  blurb?: string;
}) {
  const [playing, setPlaying] = useState<string | null>(null);

  if (videos.length === 0) return null;

  return (
    <section className="landing-inner video-wall" id="videos">
      <header className="page-head">
        <div>
          <h2 className="landing-h2">{heading}</h2>
          {blurb && <p className="muted">{blurb}</p>}
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

          /*
             THE CARD IS THE SHAPE OF WHAT IS IN IT.
             The wall lays out in justified rows — every card the same HEIGHT,
             its width following from this ratio — so a vertical reel is narrow
             beside a wide landscape video instead of towering over it. See
             `.video-grid` for why that is the layout.
          */
          const aspect = v.aspect ?? (v.portrait ? "9 / 16" : "16 / 9");

          return (
            <div
              key={v.url}
              className={`video-card${v.portrait ? " video-portrait" : ""}`}
              style={{ aspectRatio: aspect }}
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
  /**
   * THE REAL SHAPE OF EACH PICTURE, measured when it loads.
   *
   * The stage used to be a fixed 2:1 letterbox with `object-fit: cover`, which
   * is right for the wide photograph of a classroom it was designed around and
   * WRONG for everything else. A square post — which is what an institute
   * actually publishes — lost a third of itself off the top and bottom, and
   * the part it lost was usually the words.
   *
   * The browser is the only thing that knows the true ratio, and it knows it
   * the moment the file arrives. Nothing is guessed and nothing is fetched
   * twice: `naturalWidth` and `naturalHeight` are already there on the element
   * that just rendered.
   */
  const [shapes, setShapes] = useState<Record<string, number>>({});
  const usable = images.filter((i) => !broken.includes(i.url));
  const { index, go, next, previous, holdProps } = useAutoRotate(usable.length, 5000);

  if (usable.length === 0) return null;

  /*
   * CLAMPED, because a picture may be any shape at all and the stage has to
   * stay a stage. A panorama at 4:1 becomes a slot too short to see, and a
   * phone screenshot at 9:19 becomes a column taller than the window that
   * pushes everything below it off the page. Between 4:3 and 16:7 covers every
   * ordinary photograph, every square post and every portrait shot, and only
   * bites on the extremes it exists to catch.
   */
  const current = usable[index];
  const measured = current ? shapes[current.url] : undefined;
  const ratio = Math.min(Math.max(measured ?? 16 / 8, 4 / 3), 16 / 7);

  return (
    <section className="landing-inner photo-strip">
      {/*
        A stage rather than a grid. One picture at a time, large, because a
        photograph of a classroom is the thing that tells somebody what the
        place is actually like, and six thumbnails tell them nothing.

        The whole panel holds still on hover and on focus — see useAutoRotate
        for why focus matters as much as hover.
      */}
      <div className="photo-stage" style={{ aspectRatio: String(ratio) }} {...holdProps}>
        {usable.map((img, i) => (
          <figure
            key={img.url}
            className={`photo-slide${i === index ? " is-current" : ""}`}
            // The ones not showing are hidden from the reading order too, or a
            // screen reader announces six captions for one visible picture.
            aria-hidden={i !== index}
          >
            <img
              src={img.url}
              alt={img.alt}
              // The first is what somebody sees immediately; the rest can wait.
              loading={i === 0 ? "eager" : "lazy"}
              onError={() => setBroken((b) => [...b, img.url])}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (!el.naturalWidth || !el.naturalHeight) return;
                const r = el.naturalWidth / el.naturalHeight;
                // Guarded, or every load queues a render for a value that has
                // not changed — and a cross-fading gallery re-renders often.
                setShapes((prev) => (prev[img.url] === r ? prev : { ...prev, [img.url]: r }));
              }}
            />
            {img.alt && <figcaption>{img.alt}</figcaption>}
          </figure>
        ))}

        {usable.length > 1 && (
          <>
            <button className="photo-arrow photo-prev" onClick={previous} aria-label="Previous photograph">
              ‹
            </button>
            <button className="photo-arrow photo-next" onClick={next} aria-label="Next photograph">
              ›
            </button>
            {/* Manual controls, so the automatic part is a convenience rather
                than the only way through. */}
            <div className="photo-dots" role="tablist" aria-label="Photographs">
              {usable.map((img, i) => (
                <button
                  key={img.url}
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`Photograph ${i + 1} of ${usable.length}`}
                  className={`photo-dot${i === index ? " is-current" : ""}`}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          </>
        )}
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
export function NewsList({
  news,
  /** As above: the Institute's wording, defaulting to what was written here. */
  heading = "Latest from the Institute",
  blurb = "Notices we have published for everyone.",
}: {
  news: NewsItem[];
  heading?: string;
  blurb?: string;
}) {
  // Slower than the photographs: these are sentences somebody has to read, and
  // five seconds is not long enough to finish one and decide it matters.
  const { index, go, holdProps, isStill } = useAutoRotate(news.length, 9000);

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
          <h2 className="landing-h2">{heading}</h2>
          {blurb && <p className="muted">{blurb}</p>}
        </div>
      </header>

      {/*
        THE CURRENT NOTICE IS A LIVE REGION, politely. A panel whose text
        changes on a timer is invisible to a screen reader unless it is
        announced — but "assertive" would interrupt whatever the reader is in
        the middle of, for a marketing notice. Polite waits for a gap.
      */}
      <div className="news-rotator" {...holdProps} aria-live="polite" aria-atomic="true">
        {news.map((n, i) => (
          <article
            className={`news-card${i === index ? " is-current" : ""}`}
            key={n.id}
            aria-hidden={i !== index}
          >
            {n.isPinned && <span className="pill pill-warn news-pin">Pinned</span>}
            <time className="news-date" dateTime={n.publishedAt}>
              {when(n.publishedAt)}
            </time>
            <h3>{n.title}</h3>
            <p>{n.body.length > 320 ? `${n.body.slice(0, 320).trimEnd()}…` : n.body}</p>
          </article>
        ))}
      </div>

      {news.length > 1 && (
        <div className="news-controls">
          {news.map((n, i) => (
            <button
              key={n.id}
              className={`news-tab${i === index ? " is-current" : ""}`}
              aria-current={i === index}
              onClick={() => go(i)}
            >
              {/* The title, not a number: somebody choosing between notices
                  needs to know which one they are choosing. */}
              <span className="news-tab-label">{n.title}</span>
              {/* The bar fills over the dwell time, so the panel says what it
                  is about to do rather than surprising anybody — and it stops
                  dead when the rotation does. */}
              <span className={`news-progress${isStill ? " is-still" : ""}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
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
