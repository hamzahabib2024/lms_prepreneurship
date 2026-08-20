import { ConfigService } from "@nestjs/config";
import { Readable } from "node:stream";
import { generateKeyPairSync } from "node:crypto";
import { GoogleDriveStorageProvider } from "./google-drive.storage";

/**
 * THE SYSTEM NEVER DESTROYS ANYTHING IN THE INSTITUTE'S DRIVE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS INVARIANT WAS DELIBERATELY NARROWED, and the previous one is worth
 * stating so the change is visible rather than discovered:
 *
 *   BEFORE — the adapter made no writing request to Drive at all, ever, and
 *   asked Google for a read-only scope so that even a mistake in the file
 *   would be refused before it touched anything.
 *
 *   NOW — the adapter may CREATE ONE NEW FILE, through `putStream` and through
 *   nothing else, because the Institute asked to add a lecture from a laptop
 *   without giving every member of staff access to the Drive account itself.
 *
 * What has NOT changed is the part that protects the Institute's only copy of
 * its recordings: nothing here may delete, trash, move, rename or overwrite an
 * existing file. Creating a new one cannot lose an old one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three barriers, and this suite fails if any is removed:
 *
 *   every read path uses GET, and the ONLY non-GET to Drive comes from
 *   putStream — nothing else, ever;
 *
 *   DELETE is never sent to Drive by any operation, including delete();
 *
 *   the read paths still mint a drive.READONLY token. The writable scope is
 *   asked for only when a file is actually being uploaded, so a mistake
 *   anywhere else would still be refused by Google.
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

describe("the Drive adapter never destroys anything", () => {
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
        headers: new Headers({
          "content-type": "video/mp4",
          "content-length": "10",
          // For the resumable upload's first leg.
          location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test",
        }),
        json: async () => ({ files: [], user: { emailAddress: "x@y.z" }, id: "new-file" }),
        text: async () => "{}",
        body: null,
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  const toDrive = () => calls.filter((c) => !c.url.includes("oauth2.googleapis.com"));

  // ────────────────────────────────────────────────── the reading paths ──

  it("reads a folder with GETs only", async () => {
    await provider().listFolder("folder-id");
    expect(toDrive().length).toBeGreaterThan(0);
    for (const c of toDrive()) expect(c.method).toBe("GET");
  });

  it("checks a file with GETs only", async () => {
    await provider().stat("file-id");
    for (const c of toDrive()) expect(c.method).toBe("GET");
  });

  it("checks health with GETs only", async () => {
    await provider().healthCheck();
    for (const c of toDrive()) expect(c.method).toBe("GET");
  });

  it("asks whether a folder will take an upload with GETs only", async () => {
    // canAcceptUploads inspects the folder. Inspecting must not write.
    await provider().canAcceptUploads("folder-id");
    for (const c of toDrive()) expect(c.method).toBe("GET");
  });

  // ────────────────────────────────────────────── nothing is destroyed ──

  it("DELETE makes no request to Drive whatsoever", async () => {
    // Removing a catalogue entry must never destroy the recording behind it.
    await provider().delete();
    expect(calls).toEqual([]);
  });

  it("NEVER sends DELETE or PATCH to Drive, across every operation", async () => {
    /*
     * THE INVARIANT THAT DID NOT CHANGE. The Institute's recordings are their
     * only copy, and the service account holds Editor — so Drive itself would
     * permit a destructive call. This code is the only thing that stops one.
     */
    const p = provider();
    await p.listFolder("f");
    await p.stat("x");
    await p.healthCheck();
    await p.delete();
    await p.canAcceptUploads("f");
    await p.put().catch(() => undefined);
    await p
      .putStream({
        folderRef: "f",
        filename: "a.mp4",
        contentType: "video/mp4",
        sizeBytes: 4,
        body: Readable.from([Buffer.from("test")]),
      })
      .catch(() => undefined);

    const destructive = calls.filter(
      (c) => ["DELETE", "PATCH"].includes(c.method) && !c.url.includes("oauth2.googleapis.com"),
    );
    expect(destructive).toEqual([]);
  });

  it("refuses put() — a lecture goes through putStream, everything else nowhere", async () => {
    await expect(provider().put()).rejects.toThrow(/lecture video/i);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  // ─────────────────────────────────────── the one write that is allowed ──

  it("writes to Drive ONLY from putStream, and only to the upload endpoint", async () => {
    await provider().putStream({
      folderRef: "folder-id",
      filename: "lecture.mp4",
      contentType: "video/mp4",
      sizeBytes: 4,
      body: Readable.from([Buffer.from("test")]),
    });

    const writes = toDrive().filter((c) => c.method !== "GET");
    expect(writes.length).toBeGreaterThan(0);
    // Every one of them is the resumable upload, which CREATES a file. None
    // addresses an existing file id.
    for (const w of writes) {
      expect(w.url).toContain("/upload/drive/v3/files");
      expect(["POST", "PUT"]).toContain(w.method);
    }
  });

  it("creates a NEW file rather than addressing an existing one", async () => {
    // A POST to /files creates; a PATCH or PUT to /files/{id} would modify.
    // The distinction is the whole safety of the upload path.
    await provider().putStream({
      folderRef: "folder-id",
      filename: "lecture.mp4",
      contentType: "video/mp4",
      sizeBytes: 4,
      body: Readable.from([Buffer.from("test")]),
    });

    const create = toDrive().find((c) => c.method === "POST");
    expect(create).toBeDefined();
    expect(create!.url).toMatch(/\/upload\/drive\/v3\/files\?/);
    expect(create!.url).not.toMatch(/\/files\/[A-Za-z0-9_-]+/);
  });

  // ──────────────────────────────────────────────────────────── scopes ──

  it("asks Google for a READ-ONLY scope when reading", async () => {
    await provider().listFolder("f");
    const claims = scopeOfLastTokenRequest();
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.readonly");
  });

  it("asks for the writable scope ONLY when uploading", async () => {
    /*
     * Two scopes, minted and cached separately. A deployment that never
     * uploads never asks Google for a writable token at all — so a token
     * leaked from a read path cannot be used to write.
     */
    const p = provider();
    await p.listFolder("f");
    expect(scopeOfLastTokenRequest().scope).toBe(
      "https://www.googleapis.com/auth/drive.readonly",
    );

    await p.putStream({
      folderRef: "f",
      filename: "a.mp4",
      contentType: "video/mp4",
      sizeBytes: 4,
      body: Readable.from([Buffer.from("test")]),
    });
    expect(scopeOfLastTokenRequest().scope).toBe("https://www.googleapis.com/auth/drive");
  });

  it("WOULD catch a destructive call", async () => {
    // The guard above is only worth having if it can fail: prove the filter
    // recognises the thing it is looking for rather than passing on an empty
    // list forever.
    calls.push({ url: "https://www.googleapis.com/drive/v3/files/abc", method: "DELETE" });
    const destructive = calls.filter(
      (c) => ["DELETE", "PATCH"].includes(c.method) && !c.url.includes("oauth2.googleapis.com"),
    );
    expect(destructive).toHaveLength(1);
  });
});

/** The claims of the most recent assertion sent to Google's token endpoint. */
function scopeOfLastTokenRequest(): { scope: string } {
  const mock = global.fetch as unknown as jest.Mock;
  const tokenCalls = mock.mock.calls.filter((c) =>
    String(c[0]).includes("oauth2.googleapis.com"),
  );
  const last = tokenCalls[tokenCalls.length - 1]!;
  const body = (last[1] as RequestInit).body as URLSearchParams;
  const assertion = body.get("assertion")!;
  return JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString("utf8")) as {
    scope: string;
  };
}
