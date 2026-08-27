import { deflateRawSync, inflateRawSync, crc32 } from "node:zlib";

/**
 * A ZIP writer and reader, written here rather than installed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL. The archive has to be a format the Institute can open
 * on any machine with no software and no instructions — which means ZIP, and
 * nothing else comes close. Node ships the hard part (`deflateRaw`, `crc32`);
 * what is left is a container format that has not changed since 1993 and is
 * about two hundred lines. This repository already hand-writes its own PDF
 * generator (finance/pdf.ts) and its own QR encoder for the same reason, and
 * for the same payoff: no dependency to audit, to update, or to be broken by.
 *
 * THE FORMAT, briefly, because the field names below are otherwise unreadable:
 *
 *   [local header + data] for each entry, in order
 *   [central directory]   one record per entry, repeating most of the header
 *   [end of central dir]  where the directory starts, and how many entries
 *
 * A reader finds the END record by scanning BACKWARDS from the end of the file,
 * reads the central directory, and seeks to each entry. That is why the central
 * directory duplicates the headers: it is the index, and the local headers are
 * only checked once you have already been told where to look.
 *
 * TWO QUIRKS THAT COST AN AFTERNOON EACH IF YOU DO NOT KNOW THEM:
 *
 *   1. MS-DOS TIME. Dates are stored in a 1980-epoch bitfield with two-second
 *      resolution. A date before 1980 encodes as a negative year and produces a
 *      file every unzip tool refuses. `dosDateTime` clamps.
 *
 *   2. SIZES ARE 32-BIT. Above 4GB the format needs the ZIP64 extension, which
 *      this does not implement. `MAX_TOTAL` refuses rather than writing a file
 *      that appears to work and unzips to garbage — see the note there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Above this the format needs ZIP64, which this does not implement. */
export const MAX_TOTAL = 3.5 * 1024 * 1024 * 1024;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

/** 8 = deflate, 0 = stored. Tiny or incompressible entries are stored. */
const DEFLATE = 8;
const STORED = 0;

export interface ZipEntry {
  /** Forward slashes always — a backslash here is a literal filename on Unix. */
  path: string;
  data: Buffer;
  modified?: Date;
}

interface CentralRecord {
  path: string;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  offset: number;
  modified: Date;
}

/**
 * MS-DOS date and time, packed.
 *
 * Clamped to 1980 because that is the epoch: an earlier date encodes as a
 * negative year and every extraction tool in existence rejects the entry.
 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    // Seconds have ONE bit of resolution taken from them — the field holds
    // two-second units. Nothing depends on the odd second.
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Assembles a ZIP one entry at a time.
 *
 * WRITES AS IT GOES rather than collecting everything and building at the end.
 * `push` returns the bytes for that entry so a caller can send them onward
 * immediately; only the central directory — a few dozen bytes per entry — is
 * held, because the format requires it at the end and there is nowhere else to
 * put it. An archive of eight hundred students' slips therefore costs one
 * file's memory at a time rather than all of them at once.
 */
export class ZipWriter {
  private readonly central: CentralRecord[] = [];
  private offset = 0;

  /** Bytes written so far, so a caller can refuse before exceeding ZIP64. */
  get bytesWritten(): number {
    return this.offset;
  }

  get entryCount(): number {
    return this.central.length;
  }

  /** One entry. Returns the bytes to write out; nothing is buffered here. */
  push(entry: ZipEntry): Buffer {
    const modified = entry.modified ?? new Date();
    const uncompressedSize = entry.data.length;
    const crc = crc32(entry.data);

    /*
     * COMPRESSED ONLY IF IT HELPS. A JPEG, a PNG and a .gz are already
     * compressed, and deflating them spends CPU to make the file slightly
     * BIGGER. Most of this archive by volume is photographed slips, so trying
     * and keeping the smaller of the two is worth the four lines.
     */
    let method = DEFLATE;
    let payload: Buffer =
      uncompressedSize === 0 ? Buffer.alloc(0) : Buffer.from(deflateRawSync(entry.data));
    if (uncompressedSize === 0 || payload.length >= uncompressedSize) {
      method = STORED;
      payload = entry.data;
    }

    const name = Buffer.from(entry.path.replace(/\\/g, "/"), "utf8");
    const { time, date } = dosDateTime(modified);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0, which is deflate
    // Bit 11 says the filename is UTF-8. Without it a name with an accent or
    // an Urdu character extracts as mojibake on Windows.
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(uncompressedSize, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // no extra field

    this.central.push({
      path: entry.path,
      crc,
      compressedSize: payload.length,
      uncompressedSize,
      method,
      offset: this.offset,
      modified,
    });

    const chunk = Buffer.concat([header, name, payload]);
    this.offset += chunk.length;
    return chunk;
  }

  /** The central directory and the end record. Call once, last. */
  finish(): Buffer {
    const parts: Buffer[] = [];
    const start = this.offset;

    for (const e of this.central) {
      const name = Buffer.from(e.path.replace(/\\/g, "/"), "utf8");
      const { time, date } = dosDateTime(e.modified);
      const rec = Buffer.alloc(46);
      rec.writeUInt32LE(CENTRAL_SIG, 0);
      rec.writeUInt16LE(20, 4); // version made by
      rec.writeUInt16LE(20, 6); // version needed
      rec.writeUInt16LE(0x0800, 8); // UTF-8 names, as above
      rec.writeUInt16LE(e.method, 10);
      rec.writeUInt16LE(time, 12);
      rec.writeUInt16LE(date, 14);
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.compressedSize, 20);
      rec.writeUInt32LE(e.uncompressedSize, 24);
      rec.writeUInt16LE(name.length, 28);
      rec.writeUInt16LE(0, 30); // extra
      rec.writeUInt16LE(0, 32); // comment
      rec.writeUInt16LE(0, 34); // disk number — always 0, this is one file
      rec.writeUInt16LE(0, 36); // internal attributes
      rec.writeUInt32LE(0, 38); // external attributes
      rec.writeUInt32LE(e.offset, 42);
      parts.push(rec, name);
    }

    const directory = Buffer.concat(parts);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIG, 0);
    end.writeUInt16LE(0, 4); // this disk
    end.writeUInt16LE(0, 6); // disk with the directory
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(start, 16);
    end.writeUInt16LE(0, 20); // no archive comment

    const tail = Buffer.concat([directory, end]);
    this.offset += tail.length;
    return tail;
  }
}

/**
 * Reads a ZIP back — the same format in reverse, for restoring.
 *
 * WORKS FROM THE CENTRAL DIRECTORY, NOT BY WALKING THE LOCAL HEADERS. Scanning
 * forward happens to work on a well-formed file and goes wrong on a truncated
 * one, where it will happily read half an entry and report success. The end
 * record says how many entries there should be, and a count that disagrees is
 * a file that was cut short in transit — which is a thing that happens to
 * multi-gigabyte downloads and must be caught here rather than believed.
 */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  // The end record is the last 22 bytes unless there is an archive comment, so
  // it is found by scanning backwards for the signature.
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65_535; i--) {
    if (buffer.readUInt32LE(i) === END_SIG) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error("This file is not a ZIP archive, or it was cut short before the end.");
  }

  const expected = buffer.readUInt16LE(end + 10);
  const directoryOffset = buffer.readUInt32LE(end + 16);

  const out = new Map<string, Buffer>();
  let p = directoryOffset;

  for (let i = 0; i < expected; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(
        `The archive's index is damaged at entry ${i + 1} of ${expected}. ` +
          "The file is incomplete — download it again.",
      );
    }
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLength).toString("utf8");

    // The local header repeats the name and extra field, and its extra field
    // is NOT always the same length as the central one — reading the central
    // lengths here is the classic way to land in the middle of the data.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    const data: Buffer = method === DEFLATE ? Buffer.from(inflateRawSync(raw)) : raw;

    if (data.length !== uncompressedSize || crc32(data) !== crc) {
      // The checksum the format itself carries, checked before the manifest's.
      // A corrupted entry that unzips silently is how a restore puts damaged
      // data back and calls it a success.
      throw new Error(`"${name}" is corrupted inside the archive and cannot be trusted.`);
    }

    // A directory entry, which carries no data and needs none.
    if (!name.endsWith("/")) out.set(name, data);

    p += 46 + nameLength + extraLength + commentLength;
  }

  return out;
}
