import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync } from "node:crypto";
import { GoogleDriveStorageProvider } from "./google-drive.storage";

/**
 * The Drive adapter, against recorded Google responses.
 *
 * THE LISTING FIXTURE IS REAL. It is the shape Drive returned for one of the
 * Institute's own class folders, with the file ids shortened — same names,
 * same absent extensions, same `video/mp4`. Inventing a fixture here would
 * have reproduced the bug this adapter exists to fix, because an invented
 * Meet recording would have been called "recording.mp4".
 *
 * What this cannot cover is the network itself. The 302 hop in signUrl is
 * exercised against a stubbed fetch and NOT against live Drive, because that
 * needs the service account DEP-01 is waiting on. That limit is stated here
 * and in the adapter rather than left for somebody to assume.
 */

/** A throwaway RSA key, so the JWT signing path really runs. */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  client_email: "lms@prepreneurship.iam.gserviceaccount.com",
  private_key: privateKey,
});

const configWith = (values: Record<string, string>) =>
  ({ get: (key: string, fallback?: string) => values[key] ?? fallback }) as unknown as ConfigService;

/** Drive's real answer for a class folder — names verbatim. */
const FOLDER_LISTING = {
  files: [
    {
      id: "1Nkr4Vh",
      name: "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording",
      mimeType: "video/mp4",
      size: "133669985",
      createdTime: "2026-08-13T17:08:11.384Z",
      modifiedTime: "2026-08-13T17:08:11.384Z",
      thumbnailLink: "https://lh3.googleusercontent.com/drive-storage/abc=s220",
      videoMediaMetadata: { durationMillis: "4331000" },
    },
    {
      id: "1y2QRJm",
      name: "(Sec D) Graphic & UI/UX Class - 2026/08/07 20:41 PKT - Recording",
      mimeType: "video/mp4",
      size: "151042569",
      createdTime: "2026-08-07T16:53:44.795Z",
      modifiedTime: "2026-08-07T16:53:44.795Z",
    },
    {
      id: "1chatlog",
      name: "Chat",
      mimeType: "text/plain",
      size: "812",
      createdTime: "2026-08-13T17:08:12.000Z",
    },
  ],
};

type FetchStub = jest.Mock<Promise<Response>, [URL | string, RequestInit?]>;

/** Answers the token exchange, then whatever the case wants. */
function stubFetch(handler: (url: string, init?: RequestInit) => Partial<Response> | Response) {
  const fetchMock: FetchStub = jest.fn(async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "ya29.test-token", expires_in: 3600 }),
      } as Response;
    }
    return handler(url, init) as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const provider = () =>
  new GoogleDriveStorageProvider(configWith({ GOOGLE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT }));

describe("Google Drive storage", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────── credentials ──

  describe("the service account key", () => {
    it("reports itself unconfigured rather than pretending", async () => {
      const health = await new GoogleDriveStorageProvider(
        configWith({}),
      ).healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.detail).toContain("DEP-01");
    });

    it("refuses clearly when asked to work without one", async () => {
      const p = new GoogleDriveStorageProvider(configWith({}));
      await expect(p.listFolder("anything")).rejects.toThrow(/not connected/i);
    });

    it("repairs the escaped newlines a pasted key arrives with", async () => {
      // An environment variable cannot hold a real newline, so a key pasted
      // into .env has literal \n in it. Left alone, signing fails with a PEM
      // error naming nothing an administrator can act on.
      const escaped = JSON.stringify({
        client_email: "lms@example.iam.gserviceaccount.com",
        private_key: privateKey.replace(/\n/g, "\\n"),
      });
      stubFetch(() => ({ ok: true, status: 200, json: async () => FOLDER_LISTING }));
      const p = new GoogleDriveStorageProvider(
        configWith({ GOOGLE_SERVICE_ACCOUNT_JSON: escaped }),
      );
      await expect(p.listFolder("folder-id")).resolves.toHaveLength(3);
    });

    it("does not treat a key with no private_key as configured", async () => {
      const p = new GoogleDriveStorageProvider(
        configWith({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "a@b.com" }) }),
      );
      expect((await p.healthCheck()).healthy).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────── listing ──

  describe("listing a class folder", () => {
    it("reads the Institute's recordings, extensionless names and all", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => FOLDER_LISTING }));

      const entries = await provider().listFolder("1Yhkvn_G0bSrIVm70xnWrzqcyG6hooKWt");

      expect(entries).toHaveLength(3);
      const first = entries[0]!;
      expect(first.name).toBe(
        "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording",
      );
      // The field the sync now decides on. Without it, the name says "not a
      // video" and nothing is ever catalogued.
      expect(first.contentType).toBe("video/mp4");
      expect(first.isFolder).toBe(false);
      expect(first.sizeBytes).toBe(133669985);
      expect(first.durationSeconds).toBe(4331);
      expect(first.thumbnailUrl).toContain("googleusercontent.com");
    });

    it("asks for shared drives, because a Workspace institute uses one", async () => {
      // Without both flags Drive answers 200 with an EMPTY LIST for a shared
      // drive — indistinguishable from an empty folder, so the course page is
      // silently blank and nothing anywhere reports an error.
      const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ files: [] }) }));

      await provider().listFolder("folder-id");

      const listCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/files?"));
      const url = String(listCall![0]);
      expect(url).toContain("supportsAllDrives=true");
      expect(url).toContain("includeItemsFromAllDrives=true");
      expect(url).toContain("trashed+%3D+false");
    });

    it("asks for the fields it actually reads", async () => {
      // Drive returns id and name and NOTHING ELSE unless asked. Omitting
      // videoMediaMetadata here is how every card ends up with no duration.
      const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ files: [] }) }));
      await provider().listFolder("folder-id");
      const url = decodeURIComponent(
        String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/files?"))![0]),
      );
      for (const field of ["mimeType", "size", "createdTime", "videoMediaMetadata", "thumbnailLink"]) {
        expect(url).toContain(field);
      }
    });

    it("follows pagination rather than showing the first page as the whole folder", async () => {
      // A class that has run for a year has more than one page of recordings,
      // and stopping at the first would silently hide the older half.
      let call = 0;
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () =>
          ++call === 1
            ? { files: [FOLDER_LISTING.files[0]], nextPageToken: "page-2" }
            : { files: [FOLDER_LISTING.files[1]] },
      }));

      const entries = await provider().listFolder("folder-id");
      expect(entries).toHaveLength(2);
    });

    it("says the folder is not shared rather than that it is empty", async () => {
      stubFetch(() => ({ ok: false, status: 404, text: async () => "File not found" }));
      await expect(provider().listFolder("gone")).rejects.toThrow(/no longer exists|not shared/i);
    });

    it("dates a file from createdTime, not from a later rename", async () => {
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            {
              id: "x",
              name: "Class - 2026/06/23 19:59 PKT - Recording",
              mimeType: "video/mp4",
              createdTime: "2026-06-23T15:38:00.718Z",
              // Renamed months later. Believing this would date the class to
              // the day somebody tidied the folder.
              modifiedTime: "2026-06-23T21:01:44.630Z",
            },
          ],
        }),
      }));

      const [entry] = await provider().listFolder("folder-id");
      expect(entry!.modifiedAt?.toISOString()).toBe("2026-06-23T15:38:00.718Z");
    });
  });

  // ────────────────────────────────────────────────────────────── stat ──

  describe("checking a recording still exists (ARC-045)", () => {
    it("returns null for one that was deleted, so the sweep marks it MISSING", async () => {
      stubFetch(() => ({ ok: false, status: 404, text: async () => "not found" }));
      await expect(provider().stat("gone")).resolves.toBeNull();
    });

    it("returns null for one in the bin", async () => {
      // The common case by far: somebody tidying Drive, not a broken share.
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "x", name: "n", mimeType: "video/mp4", trashed: true }),
      }));
      await expect(provider().stat("x")).resolves.toBeNull();
    });

    it("returns null rather than throwing when Drive is down", async () => {
      // One unreachable file must not abandon a sweep over the whole Institute.
      stubFetch(() => {
        throw new Error("ECONNRESET");
      });
      await expect(provider().stat("x")).resolves.toBeNull();
    });

    it("reads duration and size for one that is there", async () => {
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "x",
          name: "n",
          mimeType: "video/mp4",
          size: "133669985",
          modifiedTime: "2026-08-13T17:08:11.384Z",
          videoMediaMetadata: { durationMillis: "4331000" },
        }),
      }));
      const stat = await provider().stat("x");
      expect(stat).toMatchObject({ sizeBytes: 133669985, durationSeconds: 4331 });
    });
  });

  // ──────────────────────────────────────────────────────────── playback ──

  describe("preparing a recording for playback (ARC-041/052)", () => {
    it("hands back Google's short-lived address, without downloading the file", async () => {
      const temporary =
        "https://doc-0k-8s-docs.googleusercontent.com/docs/securesc/abc/def?e=download&expires=1";
      const fetchMock = stubFetch(() => ({
        ok: false,
        status: 302,
        headers: new Headers({ location: temporary }),
      }));

      const signed = await provider().signUrl("1Nkr4Vh", 300);

      expect(signed.url).toBe(temporary);
      expect(signed.supportsRangeRequests).toBe(true);
      expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
      // The whole point of ARC-052: the API must not follow the redirect and
      // pull 133MB through itself.
      const mediaCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("alt=media"));
      expect((mediaCall![1] as RequestInit).redirect).toBe("manual");
    });

    it("NEVER returns a permanent Drive link (ARC-041)", async () => {
      // The tempting shortcut is webContentLink, which requires making the
      // file link-shared — a permanent public URL to a class recording.
      const fetchMock = stubFetch(() => ({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://doc-0k.googleusercontent.com/x?e=download" }),
      }));
      const signed = await provider().signUrl("1Nkr4Vh", 300);
      expect(signed.url).not.toContain("drive.google.com");
      expect(signed.url).not.toContain("/view");
      expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("permissions"))).toBe(true);
    });

    it("fails loudly rather than proxying when Google does not redirect", async () => {
      // If Drive ever serves the bytes directly, that is a change worth
      // learning about from an error and not from a bandwidth bill.
      stubFetch(() => ({ ok: true, status: 200, headers: new Headers() }));
      await expect(provider().signUrl("x", 300)).rejects.toThrow(/could not be prepared/i);
    });

    it("says the recording is gone when the share was revoked", async () => {
      stubFetch(() => ({ ok: false, status: 403, headers: new Headers() }));
      await expect(provider().signUrl("x", 300)).rejects.toThrow(/no longer available/i);
    });
  });

  // ───────────────────────────────────────────────────────────── writing ──

  describe("what it will not do", () => {
    it("refuses to upload — teachers put video in Drive themselves (CON-01)", async () => {
      await expect(provider().put()).rejects.toThrow(/uploaded to Google Drive directly/i);
    });

    it("never deletes from the Institute's Drive", async () => {
      // Removing a catalogue entry must not destroy the recording behind it.
      const fetchMock = stubFetch(() => ({ ok: true, status: 200 }));
      await provider().delete();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks for a read-only scope", async () => {
      const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ files: [] }) }));
      await provider().listFolder("f");
      const tokenCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("oauth2.googleapis.com"),
      );
      // The body is a URLSearchParams, so read it as one rather than
      // stringifying an object and hoping.
      const body = (tokenCall![1] as RequestInit).body as URLSearchParams;
      const assertion = body.get("assertion")!;
      const claims = JSON.parse(
        Buffer.from(assertion.split(".")[1]!, "base64url").toString("utf8"),
      ) as { scope: string };
      expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.readonly");
    });
  });

  // ─────────────────────────────────────────────────────────────── tokens ──

  describe("the access token", () => {
    it("is fetched once and reused", async () => {
      const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ files: [] }) }));
      const p = provider();
      await p.listFolder("a");
      await p.listFolder("b");
      const tokenCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("oauth2.googleapis.com"),
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it("names the clock when Google refuses the assertion", async () => {
      // invalid_grant almost never means the key is wrong. It means the
      // server's clock has drifted, or the key was deleted in the console.
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant"}',
      })) as unknown as typeof fetch;

      await expect(provider().listFolder("f")).rejects.toMatchObject({
        internal: expect.stringContaining("clock"),
      });
    });
  });

  // ─────────────────────────────────────────────────────────────── health ──

  describe("the health check", () => {
    it("REACHES Drive rather than checking that a variable is set", async () => {
      // A check that only reads configuration reports healthy while the key is
      // revoked, the clock is wrong, or the folder was never shared — which
      // are the three ways this actually breaks.
      const fetchMock = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ user: { emailAddress: "lms@prepreneurship.iam.gserviceaccount.com" } }),
      }));

      const health = await provider().healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.detail).toContain("lms@prepreneurship");
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/about"))).toBe(true);
    });

    it("is unhealthy when the key has been revoked", async () => {
      stubFetch(() => ({ ok: false, status: 401, text: async () => "unauthorized" }));
      const health = await provider().healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.detail).toContain("revoked");
    });
  });
});
