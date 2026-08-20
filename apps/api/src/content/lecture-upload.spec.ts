import { ConfigService } from "@nestjs/config";
import { Readable } from "node:stream";
import { generateKeyPairSync } from "node:crypto";
import { GoogleDriveStorageProvider } from "./storage/google-drive.storage";

/**
 * Uploading a lecture into the Institute's Drive — FR-VID-002.
 *
 * THE CONSTRAINT THESE EXIST FOR is not a bug and cannot be coded around:
 *
 *   A GOOGLE SERVICE ACCOUNT HAS NO DRIVE STORAGE QUOTA.
 *
 * Measured against this Institute's own project. The account lists the
 * Recordings folder, reads every file in it, and Drive answers
 * `capabilities.canAddChildren: true` for that folder — and the upload is
 * refused, 403 `storageQuotaExceeded`, because a file in somebody's My Drive
 * must be charged to somebody and a service account is nobody.
 *
 * So the interesting behaviour is not the happy path. It is:
 *
 *   saying no BEFORE the transfer rather than after it, because the alternative
 *   is a person waiting for 300 MB to cross their connection to be told it was
 *   never going to work;
 *
 *   and saying no in words that name the two fixes, because the raw Google
 *   message sends an administrator to buy more Drive storage, which is not the
 *   problem and will not help.
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

/** Google's actual refusal, verbatim. */
const QUOTA_REFUSAL = JSON.stringify({
  error: {
    code: 403,
    message:
      "Service Accounts do not have storage quota. Leverage shared drives, or use OAuth delegation instead.",
    errors: [{ reason: "storageQuotaExceeded" }],
  },
});

describe("uploading a lecture to Google Drive", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  const provider = (extra: Record<string, string> = {}) =>
    new GoogleDriveStorageProvider({
      get: (k: string, d?: string) =>
        k === "GOOGLE_SERVICE_ACCOUNT_JSON" ? SERVICE_ACCOUNT : (extra[k] ?? d),
    } as unknown as ConfigService);

  /** Answers the token exchange, then whatever the case wants. */
  function stub(handler: (url: string, init?: RequestInit) => Partial<Response>) {
    global.fetch = jest.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "ya29.test", expires_in: 3600 }),
        } as Response;
      }
      return handler(url, init) as Response;
    }) as unknown as typeof fetch;
    return global.fetch as unknown as jest.Mock;
  }

  const folder = (over: Record<string, unknown> = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "folder-1",
      name: "(Sec D) Graphic Class",
      capabilities: { canAddChildren: true },
      ...over,
    }),
    text: async () => "{}",
  });

  // ─────────────────────────────────────────── saying no, before sending ──

  it("REFUSES an ordinary My Drive folder, and names both ways out", async () => {
    // No driveId means it is not a Shared Drive. This is the Institute's
    // situation today and the single most important case in this file.
    stub(() => folder());

    const can = await provider().canAcceptUploads("folder-1");

    expect(can.accepted).toBe(false);
    expect(can.reason).toMatch(/no storage quota/i);
    // Both fixes, because which one applies depends on the Institute.
    expect(can.reason).toMatch(/shared drive/i);
    expect(can.reason).toMatch(/GOOGLE_IMPERSONATE_SUBJECT/);
    // And that the recording is not lost in the meantime.
    expect(can.reason).toMatch(/stored by the System/i);
  });

  it("ACCEPTS a Shared Drive folder", async () => {
    // A file on a Shared Drive is owned by the drive rather than by a person,
    // so there is no quota to charge and the upload succeeds.
    stub(() => folder({ driveId: "0AKx…" }));

    const can = await provider().canAcceptUploads("folder-1");
    expect(can.accepted).toBe(true);
    expect(can.destination).toBe("(Sec D) Graphic Class");
  });

  it("ACCEPTS an ordinary folder once impersonation is configured", async () => {
    // Domain-wide delegation is the other way out: the token is issued AS a
    // real Workspace user, and the file is charged to them.
    stub(() => folder());

    const can = await provider({
      GOOGLE_IMPERSONATE_SUBJECT: "office@prepreneurship.pk",
    }).canAcceptUploads("folder-1");

    expect(can.accepted).toBe(true);
  });

  it("refuses a folder the account may read but not add to", async () => {
    stub(() => folder({ driveId: "0AKx…", capabilities: { canAddChildren: false } }));

    const can = await provider().canAcceptUploads("folder-1");
    expect(can.accepted).toBe(false);
    // The fix is a sharing level, and saying "Editor" is the whole of it.
    expect(can.reason).toMatch(/editor/i);
  });

  it("refuses when the class has no folder connected at all", async () => {
    const can = await provider().canAcceptUploads(null);
    expect(can.accepted).toBe(false);
    expect(can.reason).toMatch(/no Drive folder/i);
  });

  it("says the folder is not shared when Drive answers 404", async () => {
    stub(() => ({ ok: false, status: 404, json: async () => ({}), text: async () => "{}" }));

    const can = await provider().canAcceptUploads("folder-1");
    expect(can.accepted).toBe(false);
    expect(can.reason).toMatch(/not shared|no longer exists/i);
  });

  // ───────────────────────────────────────────────────── the upload itself ──

  it("opens a resumable session and streams the bytes to it", async () => {
    /*
     * RESUMABLE, NOT MULTIPART, and the file sizes decide it: a single request
     * carrying 300 MB fails on a dropped connection with nothing to resume
     * from. It is also the only shape that lets the body be a stream, so the
     * recording never exists in this process's memory.
     */
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = stub((url, init) => {
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      if (url.includes("uploadType=resumable")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ location: "https://upload.example/session-1" }),
          text: async () => "{}",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "new-file-1", name: "a.mp4", size: "1234", mimeType: "video/mp4" }),
        text: async () => "{}",
      };
    });

    const ref = await provider().putStream({
      folderRef: "folder-1",
      filename: "Colour theory.mp4",
      contentType: "video/mp4",
      sizeBytes: 1234,
      body: Readable.from([Buffer.from("video")]),
    });

    expect(ref.storageRef).toBe("new-file-1");
    expect(ref.sizeBytes).toBe(1234);

    const session = calls.find((c) => c.url.includes("uploadType=resumable"));
    expect(session?.method).toBe("POST");
    // The bytes go to the session URL Google handed back, as a PUT. An
    // assertion that only checked the URL was reached would pass on a GET.
    expect(
      calls.some((c) => c.url === "https://upload.example/session-1" && c.method === "PUT"),
    ).toBe(true);

    // The parent is named, or the recording lands loose in the root where no
    // class reads it.
    const sessionInit = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("resumable"),
    )![1] as RequestInit;
    // The metadata leg sends JSON, so the body is a string. Asserting that
    // rather than stringifying a union keeps the failure honest: if it ever
    // stops being one, this throws instead of comparing "[object Object]".
    const body = JSON.parse(sessionInit.body as string) as { parents?: string[]; name?: string };
    expect(body.parents).toEqual(["folder-1"]);
    expect(body.name).toBe("Colour theory.mp4");
  });

  it("tells Google the size and type up front, so it can refuse early", async () => {
    const fetchMock = stub((url) =>
      url.includes("resumable")
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ location: "https://upload.example/s" }),
            text: async () => "{}",
          }
        : { ok: true, status: 200, json: async () => ({ id: "f" }), text: async () => "{}" },
    );

    await provider().putStream({
      folderRef: "folder-1",
      filename: "a.mp4",
      contentType: "video/mp4",
      sizeBytes: 999,
      body: Readable.from([Buffer.from("v")]),
    });

    const init = fetchMock.mock.calls.find((c) => String(c[0]).includes("resumable"))![1] as
      RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Upload-Content-Length"]).toBe("999");
    expect(headers["X-Upload-Content-Type"]).toBe("video/mp4");
  });

  it("translates the quota refusal instead of repeating Google's wording", async () => {
    // The raw message sends an administrator to buy more Drive storage. That
    // is not the problem and more of it will not help.
    stub((url) =>
      url.includes("resumable")
        ? { ok: false, status: 403, text: async () => QUOTA_REFUSAL }
        : { ok: true, status: 200, json: async () => ({}), text: async () => "{}" },
    );

    await expect(
      provider().putStream({
        folderRef: "folder-1",
        filename: "a.mp4",
        contentType: "video/mp4",
        sizeBytes: 10,
        body: Readable.from([Buffer.from("v")]),
      }),
    ).rejects.toThrow(/Shared Drive|GOOGLE_IMPERSONATE_SUBJECT/);
  });

  it("does not claim success when Drive returns no session URL", async () => {
    // A 200 with no Location is a Drive contract change, not an upload. Sending
    // the bytes nowhere and reporting success would catalogue a lecture that
    // does not exist — discovered by a student pressing play.
    stub((url) =>
      url.includes("resumable")
        ? { ok: true, status: 200, headers: new Headers({}), text: async () => "{}" }
        : { ok: true, status: 200, json: async () => ({ id: "f" }), text: async () => "{}" },
    );

    await expect(
      provider().putStream({
        folderRef: "folder-1",
        filename: "a.mp4",
        contentType: "video/mp4",
        sizeBytes: 10,
        body: Readable.from([Buffer.from("v")]),
      }),
    ).rejects.toThrow(/could not be uploaded/i);
  });
});
