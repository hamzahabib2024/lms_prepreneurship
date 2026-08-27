/**
 * The ZIP container, checked against itself and against the format.
 *
 * A HAND-WRITTEN FORMAT NEEDS THESE MORE THAN A LIBRARY WOULD. Nothing here is
 * clever; all of it is the kind of thing that is silently wrong and only
 * discovered on the day somebody tries to open the archive — which, for this
 * feature, is the worst day available.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipWriter, readZip } from "./zip";

const build = (entries: Array<{ path: string; data: Buffer }>): Buffer => {
  const zip = new ZipWriter();
  const parts = entries.map((e) => zip.push(e));
  return Buffer.concat([...parts, zip.finish()]);
};

describe("a ZIP this writes, this can read back", () => {
  it("round-trips text, binary and empty entries", () => {
    const entries = [
      { path: "README.txt", data: Buffer.from("What this is.\nAnd what it is not.\n", "utf8") },
      { path: "records/fees/payments.csv", data: Buffer.from("id,amount\n1,25000\n", "utf8") },
      // Incompressible, so it exercises the STORED path.
      { path: "files/slip.bin", data: Buffer.from(Array.from({ length: 512 }, (_, i) => i % 251)) },
      { path: "files/empty.txt", data: Buffer.alloc(0) },
    ];

    const out = readZip(build(entries));

    expect([...out.keys()].sort()).toEqual([
      "README.txt",
      "files/empty.txt",
      "files/slip.bin",
      "records/fees/payments.csv",
    ]);
    for (const e of entries) {
      expect(out.get(e.path)).toEqual(e.data);
    }
  });

  it("keeps a large compressible entry intact", () => {
    // Deflate's own path, and the one where a wrong CRC or size shows up.
    const big = Buffer.from("the same sentence, over and over. ".repeat(20_000), "utf8");
    const out = readZip(build([{ path: "system/rows.ndjson", data: big }]));
    expect(out.get("system/rows.ndjson")).toEqual(big);
  });

  it("keeps non-ASCII filenames readable", () => {
    // Bit 11 of the flags says the name is UTF-8. Without it this extracts as
    // mojibake on Windows, which is where the Institute will open it.
    const name = "records/students/CIIT-SP26-عائشة/registration.json";
    const out = readZip(build([{ path: name, data: Buffer.from("{}", "utf8") }]));
    expect(out.has(name)).toBe(true);
  });

  it("refuses a truncated archive rather than reading half of it", () => {
    // The failure that matters: a download cut short must be REPORTED, not
    // silently restored as a partial System.
    const full = build([{ path: "a.txt", data: Buffer.from("hello") }]);
    expect(() => readZip(full.subarray(0, full.length - 8))).toThrow(/not a ZIP|cut short/i);
  });

  it("detects a corrupted entry", () => {
    const full = build([{ path: "a.txt", data: Buffer.from("hello world, at length") }]);
    // Flip a byte inside the stored data, past the 30-byte local header.
    const damaged = Buffer.from(full);
    damaged[40] = damaged[40]! ^ 0xff;
    expect(() => readZip(damaged)).toThrow(/corrupted/i);
  });

  it("dates before 1980 do not produce an unreadable entry", () => {
    // MS-DOS time is 1980-epoch; an earlier date encodes as a negative year
    // and every extraction tool refuses the file.
    const out = readZip(
      build([{ path: "old.txt", data: Buffer.from("x") }]).length
        ? (() => {
            const zip = new ZipWriter();
            const chunk = zip.push({
              path: "old.txt",
              data: Buffer.from("x"),
              modified: new Date("1970-01-01T00:00:00Z"),
            });
            return Buffer.concat([chunk, zip.finish()]);
          })()
        : Buffer.alloc(0),
    );
    expect(out.get("old.txt")).toEqual(Buffer.from("x"));
  });
});

/**
 * THE ASSERTION THAT ACTUALLY MATTERS: a tool we did not write can open it.
 *
 * Round-tripping through our own reader proves the two halves agree with each
 * other, which they would even if both were wrong about the format. This opens
 * the file with the operating system's own extractor — PowerShell on Windows,
 * `unzip` elsewhere — and is skipped where neither exists rather than failing
 * on somebody's machine for a reason that is not about this code.
 */
describe("a ZIP this writes, the operating system can open", () => {
  const tools = (): { cmd: string; args: (zip: string, out: string) => string[] } | null => {
    for (const candidate of [
      { probe: ["unzip", ["-v"]], cmd: "unzip", args: (z: string, o: string) => ["-o", z, "-d", o] },
      {
        probe: ["powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]],
        cmd: "powershell",
        args: (z: string, o: string) => [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${z}' -DestinationPath '${o}' -Force`,
        ],
      },
    ]) {
      try {
        execFileSync(candidate.probe[0] as string, candidate.probe[1] as string[], {
          stdio: "ignore",
        });
        return { cmd: candidate.cmd, args: candidate.args };
      } catch {
        // Not on this machine; try the next.
      }
    }
    return null;
  };

  it("extracts with the system's own unzip", () => {
    const tool = tools();
    if (!tool) {
      // Reported rather than silently passing, so a green run on a machine
      // with neither tool is not mistaken for proof.
      console.warn("No unzip or PowerShell available; skipping the external check.");
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "lms-zip-"));
    try {
      const zipPath = join(dir, "archive.zip");
      const body = "slip bytes, and a comma, and a \"quote\"\n";
      writeFileSync(
        zipPath,
        build([
          { path: "README.txt", data: Buffer.from("hello\n", "utf8") },
          { path: "records/students/S-1/fee-record.csv", data: Buffer.from(body, "utf8") },
        ]),
      );

      const out = join(dir, "out");
      execFileSync(tool.cmd, tool.args(zipPath, out), { stdio: "ignore" });

      expect(readFileSync(join(out, "README.txt"), "utf8")).toBe("hello\n");
      expect(readFileSync(join(out, "records", "students", "S-1", "fee-record.csv"), "utf8")).toBe(
        body,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
