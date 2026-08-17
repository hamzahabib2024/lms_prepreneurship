import { Controller, Get, Head, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { AppError } from "@lms/shared";
import { Public } from "../rbac/permissions.guard";
import { LocalStorageProvider } from "./storage/local.storage";

/**
 * THE ROUTE THE SIGNED URL HAS ALWAYS POINTED AT — and which did not exist.
 *
 * `LocalStorageProvider.signUrl` mints `/api/v1/media/<ref>?exp=…&sig=…`, and
 * `verifySignature` was written to check exactly that. Nothing served it. So
 * every playback on local storage — which is every playback, until DEP-01 —
 * ended in a 404: the ticket was issued, the redirect was correct, the
 * signature was valid, and the address led nowhere. The player showed "this
 * recording could not be played", which reads as a broken file rather than a
 * missing endpoint.
 *
 * PUBLIC, AND THAT IS THE DESIGN. The signature is the authorisation: it is
 * HMACed over the storage reference and an expiry with a secret only the
 * server holds, it cannot be forged, and it stops working by itself. That is
 * the whole point of ARC-052 — the browser fetches media DIRECTLY, so it
 * cannot be carrying a session; a bearer token does not survive a redirect,
 * and `<video src>` sends no Authorization header. The permission was already
 * checked twice before this address was ever produced: once by the matrix
 * (lecture_playback:read), once by the scope predicate deciding the caller may
 * see that lecture at all, and the ticket that yielded this URL is bound to
 * the person it was issued to and expires in fifteen minutes.
 *
 * IT STREAMS. `get()` returns a Buffer, which is correct for a payment slip
 * and ruinous for a 363 MB recording — one viewer would pull the whole file
 * into the API's memory. This opens a read stream and honours Range, which is
 * also what makes seeking work at all (ARC-042): without 206 responses a
 * browser can only play from the beginning, and dragging the scrubber on an
 * hour-long class does nothing.
 */
@Controller()
export class MediaController {
  constructor(private readonly local: LocalStorageProvider) {}

  @Public()
  @Get("media/*")
  async serve(
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.send(exp, sig, req, res, "GET");
  }

  /**
   * Some players issue HEAD first to learn the length and whether ranges are
   * supported before they fetch anything. Answering 404 to that makes the
   * player give up before it ever asks for the video.
   */
  @Public()
  @Head("media/*")
  async head(
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.send(exp, sig, req, res, "HEAD");
  }

  private async send(
    exp: string,
    sig: string,
    req: Request,
    res: Response,
    method: "GET" | "HEAD",
  ): Promise<void> {
    // A storage reference contains slashes, so the route is a wildcard and
    // the value arrives in req.params rather than as a named parameter —
    // Express 4 puts it at "0", Express 5 at a name. Read whatever is there
    // rather than binding to one, because the difference is invisible until
    // the framework is upgraded and every video silently stops playing.
    const params = req.params as Record<string, string | string[] | undefined>;
    const raw = params["0"] ?? params["path"] ?? "";
    const storageRef = Array.isArray(raw) ? raw.join("/") : raw;

    const expiresAt = Number(exp);
    if (!storageRef || !Number.isFinite(expiresAt) || !sig) {
      throw new AppError("AUTH_FORBIDDEN", { message: "This media link is not valid." });
    }

    // The signature covers the reference AND the expiry, so neither can be
    // changed independently: editing the reference to point at another file
    // invalidates it, and so does extending the expiry.
    if (!this.local.verifySignature(storageRef, expiresAt, sig)) {
      throw new AppError("AUTH_TOKEN_EXPIRED", {
        message: "This playback link has expired. Reload the lecture to continue watching.",
      });
    }

    // Through the provider, so the traversal check that guards every other
    // path in the System guards this one too. "a/../../etc/passwd" is only
    // recognisable as traversal after resolution, and this is the one route
    // where the path comes from the URL.
    const file = this.local.resolvePath(storageRef);

    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      throw new AppError("RESOURCE_NOT_FOUND", {
        message: "That recording is no longer available.",
        internal: `Signed media reference resolved to nothing on disk: ${storageRef}`,
      });
    }

    res.setHeader("Content-Type", contentTypeOf(storageRef));
    res.setHeader("Accept-Ranges", "bytes");
    // Private: a signed URL is one person's for fifteen minutes, and a shared
    // cache holding it would serve it to whoever asked next.
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    // The file is served under a System-generated name; the browser must not
    // be invited to guess a type from content (SEC-FIL-005).
    res.setHeader("X-Content-Type-Options", "nosniff");

    const range = parseRange(req.headers.range, info.size);

    if (range === "unsatisfiable") {
      res.status(416).setHeader("Content-Range", `bytes */${info.size}`);
      res.end();
      return;
    }

    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      if (method === "HEAD") return void res.end();
      createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.status(200);
    res.setHeader("Content-Length", String(info.size));
    if (method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  }
}

/**
 * From the reference, which is the only thing there is: files are stored under
 * System-generated names and nothing records a content type beside them.
 * Video is what this route exists for; the rest are the documents a signed
 * link also covers.
 */
function contentTypeOf(ref: string): string {
  const ext = ref.split(".").pop()?.toLowerCase().split("/")[0] ?? "";
  const types: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return types[ext] ?? "application/octet-stream";
}

/**
 * `Range: bytes=0-` and friends — ARC-042.
 *
 * Deliberately handles only a single range. Multipart ranges are legal and no
 * browser asks for one to play video; implementing them would be code that
 * never runs, which is code nobody ever notices is wrong.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;

  if (rawStart === "") {
    // "bytes=-500" — the LAST 500 bytes. Players ask for this to read the
    // moov atom of an MP4 that has it at the end, which is most recordings
    // straight out of a camera or a meeting.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return "unsatisfiable";
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size || start < 0) return "unsatisfiable";
  // Clamped rather than refused: a player asking for more than there is wants
  // what is there, and 416 would stop playback at the last chunk of every file.
  if (end >= size) end = size - 1;
  if (end < start) return "unsatisfiable";

  return { start, end };
}
