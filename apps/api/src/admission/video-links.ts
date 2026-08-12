/**
 * Turning a pasted share link into something the public page can show.
 *
 * WHATEVER IS PASTED, THE PAGE STILL WORKS. These come from a settings field an
 * administrator types into, so the input is a person copying from a phone: a
 * URL with tracking parameters, a shortened youtu.be, a Shorts link, a TikTok
 * link with the trailing slash, or a sentence with a URL somewhere in it. A
 * link this cannot read becomes a plain link rather than a broken player, and
 * nothing here ever throws.
 *
 * NO NETWORK CALL. Resolving a TikTok short link or fetching a title would mean
 * the public page waits on a third party to render, and a slow response from
 * TikTok would become a slow Institute. Everything below is string work.
 */

export type VideoProvider = "youtube" | "tiktok" | "facebook" | "instagram" | "other";

export interface VideoLink {
  /** Exactly what was pasted, so a reader can always reach the original. */
  url: string;
  provider: VideoProvider;
  /** The provider's id, where one could be read from the URL. */
  id: string | null;
  /** A privacy-respecting embed URL, or null when we cannot build one. */
  embedUrl: string | null;
  /** A still to show before anyone clicks. Null means draw a placeholder. */
  thumbnailUrl: string | null;
  /** Vertical formats get a taller frame; a 16:9 player in a 9:16 box is letterboxed twice. */
  portrait: boolean;
}

/** A YouTube id is 11 characters of the URL-safe alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function safeUrl(raw: string): URL | null {
  try {
    // A pasted link often arrives without a scheme.
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function youtubeIdFrom(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }

  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v && YOUTUBE_ID.test(v)) return v;

    // /shorts/ID, /embed/ID, /live/ID, /v/ID
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) {
      const id = parts[1] ?? "";
      return YOUTUBE_ID.test(id) ? id : null;
    }
  }
  return null;
}

function tiktokIdFrom(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (!host.endsWith("tiktok.com")) return null;
  // .../@handle/video/1234567890123456789
  const match = url.pathname.match(/\/video\/(\d{6,})/);
  return match?.[1] ?? null;
}

/**
 * Reads one pasted line.
 *
 * Accepts a bare URL or a URL somewhere inside a line of text, because a
 * settings box invites both.
 */
export function parseVideoLink(raw: string): VideoLink | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const found = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? trimmed.split(/\s+/)[0] ?? trimmed;
  const url = safeUrl(found.replace(/[),.]+$/, ""));
  if (!url) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // A HOSTNAME WITH A DOT IN IT. Without this, `new URL("https://nonsense")`
  // succeeds — a bare word typed into the box becomes a link published on the
  // Institute's front page. A person who pasted a real link always has a dot.
  if (!url.hostname.includes(".")) return null;

  const host = url.hostname.replace(/^www\./, "");

  const youtube = youtubeIdFrom(url);
  if (youtube) {
    const isShort = /\/shorts\//.test(url.pathname);
    return {
      url: url.toString(),
      provider: "youtube",
      id: youtube,
      // youtube-nocookie, and not by accident: the ordinary embed sets
      // tracking cookies on a visitor who has not pressed play, on a page a
      // sixteen-year-old reaches by searching for a diploma.
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}?rel=0`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`,
      portrait: isShort,
    };
  }

  const tiktok = tiktokIdFrom(url);
  if (tiktok) {
    return {
      url: url.toString(),
      provider: "tiktok",
      id: tiktok,
      embedUrl: `https://www.tiktok.com/embed/v2/${tiktok}`,
      // TikTok gives no thumbnail without an API call, so the page draws one.
      thumbnailUrl: null,
      portrait: true,
    };
  }

  if (host.endsWith("facebook.com") || host === "fb.watch") {
    return {
      url: url.toString(),
      provider: "facebook",
      id: null,
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
        url.toString(),
      )}&show_text=false`,
      thumbnailUrl: null,
      portrait: false,
    };
  }

  if (host.endsWith("instagram.com")) {
    const reel = url.pathname.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    return {
      url: url.toString(),
      provider: "instagram",
      id: reel?.[2] ?? null,
      embedUrl: reel ? `https://www.instagram.com/${reel[1]}/${reel[2]}/embed` : null,
      thumbnailUrl: null,
      portrait: true,
    };
  }

  // Recognised as a link, not as a player. Shown as a link rather than dropped,
  // because an administrator who pasted something meant to publish it.
  return {
    url: url.toString(),
    provider: "other",
    id: null,
    embedUrl: null,
    thumbnailUrl: null,
    portrait: false,
  };
}

/** Reads the whole setting, discarding what cannot be read at all. */
export function parseVideoLinks(values: readonly string[] | undefined): VideoLink[] {
  return (values ?? [])
    .flatMap((v) => v.split(/[\r\n]+/))
    .map(parseVideoLink)
    .filter((v): v is VideoLink => v !== null)
    // A duplicate paste is a mistake, not an intention to show it twice.
    .filter((v, i, all) => all.findIndex((o) => o.url === v.url) === i)
    .slice(0, 12);
}
