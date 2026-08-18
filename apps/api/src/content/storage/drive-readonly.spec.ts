import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync } from "node:crypto";
import { GoogleDriveStorageProvider } from "./google-drive.storage";

/**
 * THE SYSTEM NEVER WRITES TO THE INSTITUTE'S DRIVE.
 *
 * The Institute's recordings are their only copy. Nothing here may delete,
 * move, rename, trash or overwrite one — and now that the service account
 * holds EDITOR rather than viewer, Drive itself would permit it. The account
 * was raised because Google's "viewers cannot download" restriction blocks
 * playback for readers; the side effect is that the only thing standing
 * between this code and a destructive call is this code.
 *
 * So it is pinned here rather than trusted:
 *
 *   every request this adapter makes is a GET, or a POST to Google's token
 *   endpoint — nothing else, ever;
 *
 *   the OAuth scope asked for is drive.READONLY, so even a mistake in this
 *   file would be refused by Google before it touched a file;
 *
 *   delete() makes no request at all.
 *
 * Two independent barriers, and this suite fails if either is removed.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT = JSON.stringify({
  client_email: "lms-drive@prepreneurship-lms.iam.gserviceaccount.com",
  private_key: privateKey,
});

describe("the Drive adapter never modifies anything", () => {
  const realFetch = global.fetch;
  let calls: Array<{ url: string; method: string }>;

  const provider = () =>
    new GoogleDriveStorageProvider({
      get: (k: string, d?: string) => (k === "GOOGLE_SERVICE_ACCOUNT_JSON" ? SERVICE_ACCOUNT : d),
    } as unknown as ConfigService);

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (input: URL | string, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : input;
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "ya29.test", expires_in: 3600 }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "video/mp4", "content-length": "10" }),
        json: async () => ({ files: [], user: { emailAddress: "x@y.z" } }),
        text: async () => "{}",
        body: null,
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  /** Anything that could change a file in Drive. */
  const DESTRUCTIVE = ["POST", "PUT", "PATCH", "DELETE"];

  it("reads a folder with GETs only", async () => {
    await provider().listFolder("folder-id");
    const toDrive = calls.filter((c) => !c.url.includes("oauth2.googleapis.com"));
    expect(toDrive.length).toBeGreaterThan(0);
    for (const c of toDrive) expect(c.method).toBe("GET");
  });

  it("checks a file with GETs only", async () => {
    await provider().stat("file-id");
    for (const c of calls.filter((c) => !c.url.includes("oauth2"))) expect(c.method).toBe("GET");
  });

  it("checks health with GETs only", async () => {
    await provider().healthCheck();
    for (const c of calls.filter((c) => !c.url.includes("oauth2"))) expect(c.method).toBe("GET");
  });

  it("DELETE makes no request to Drive whatsoever", async () => {
    // Removing a catalogue entry must never destroy the recording behind it.
    await provider().delete();
    expect(calls).toEqual([]);
  });

  it("refuses to upload", async () => {
    await expect(provider().put()).rejects.toThrow(/uploaded to Google Drive directly/i);
    expect(calls.filter((c) => DESTRUCTIVE.includes(c.method))).toEqual([]);
  });

  it("never sends a destructive verb to googleapis.com, across every operation", async () => {
    const p = provider();
    await p.listFolder("f");
    await p.stat("x");
    await p.healthCheck();
    await p.delete();
    await p.put().catch(() => undefined);

    const destructive = calls.filter(
      (c) => DESTRUCTIVE.includes(c.method) && !c.url.includes("oauth2.googleapis.com/token"),
    );
    expect(destructive).toEqual([]);
  });

  it("asks Google for a READ-ONLY scope, so a mistake here would still be refused", async () => {
    await provider().listFolder("f");
    const token = calls.find((c) => c.url.includes("oauth2.googleapis.com"));
    expect(token).toBeDefined();

    const mock = global.fetch as unknown as jest.Mock;
    const call = mock.mock.calls.find((c) => String(c[0]).includes("oauth2.googleapis.com"))!;
    const body = (call[1] as RequestInit).body as URLSearchParams;
    const assertion = body.get("assertion")!;
    const claims = JSON.parse(
      Buffer.from(assertion.split(".")[1]!, "base64url").toString("utf8"),
    ) as { scope: string };

    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.readonly");
    // Not the writable scopes, however convenient they might look one day.
    expect(claims.scope).not.toContain("drive.file");
    expect(claims.scope).toBe(claims.scope.replace(/\bhttps:\/\/www\.googleapis\.com\/auth\/drive$/, ""));
  });

  it("WOULD catch a destructive call", async () => {
    // The guard above is only worth having if it can fail: prove the filter
    // recognises the thing it is looking for rather than passing on an empty
    // list forever.
    calls.push({ url: "https://www.googleapis.com/drive/v3/files/abc", method: "DELETE" });
    const destructive = calls.filter(
      (c) => DESTRUCTIVE.includes(c.method) && !c.url.includes("oauth2.googleapis.com/token"),
    );
    expect(destructive).toHaveLength(1);
  });
});
