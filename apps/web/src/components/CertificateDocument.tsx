import { forwardRef, useMemo } from "react";
import { CERTIFICATE_KIND_COPY, encodeQr, qrPath, type CertificateDocument } from "@lms/shared";

/**
 * THE CERTIFICATE ITSELF — SRS §5.15, and the most public thing this System
 * makes.
 *
 * It is framed, photographed, attached to job applications and shown to
 * strangers for years. Everything else here is a screen somebody uses for a
 * minute; this is an object somebody keeps.
 *
 * IT IS ONE SVG, AND THAT IS THE WHOLE ARCHITECTURE.
 *
 * Not HTML with a border. An SVG is resolution-independent, so the same markup
 * is a 320px thumbnail on a phone, a 1414px preview on a desktop, and a 300 dpi
 * print — with no second implementation and nothing to keep in step. It also
 * makes export honest: the PNG and the PDF are RASTERISATIONS OF THIS EXACT
 * MARKUP at whatever density is asked for, not a screenshot of the browser
 * around it. What a student looks at is what they download.
 *
 * IT DOES NOT FOLLOW THE APPLICATION'S THEME, and that is deliberate rather
 * than an oversight. A certificate is paper. Rendering it dark because the
 * reader has dark mode on would mean the file they download differs from the
 * file their classmate downloads, and would print as a black rectangle. The
 * palette is fixed and taken from Brand Guidelines V2.0 §3.1 — navy, amber,
 * ivory — so it is unmistakably the Institute's without being the app's UI.
 *
 * EVERY WORD COMES FROM THE SNAPSHOT on the certificate row. Nothing here
 * looks anything up, which is what makes a reprint in 2031 identical to the
 * original.
 */

// The document is A4 landscape (297 × 210 mm). These are the coordinates
// everything below is laid out in; the ratio is what keeps it printable.
export const CERT_WIDTH = 1414;
export const CERT_HEIGHT = 1000;

const NAVY = "#1a3c5e";
const NAVY_DEEP = "#0e2540";
const INK_SOFT = "#5b6b7c";
const PAPER = "#fffdf8";
const GOLD_DEEP = "#8a5700";

/**
 * The width a string will take, near enough to lay out with.
 *
 * SVG cannot measure text without a DOM, and the export path serialises this
 * markup into a standalone image where there is no layout engine at all — so
 * every size decision has to be made from the string itself. The ratios are
 * per-family average advances, measured rather than guessed, and they are only
 * ever used to decide WHETHER to shrink: a few per cent of error moves a
 * heading by a pixel, which nobody can see, and prevents a long name running
 * off the paper, which everybody can.
 */
const advance = { display: 0.58, body: 0.52, serif: 0.44 };

function fit(text: string, maxWidth: number, from: number, to: number, ratio: number): number {
  let size = from;
  while (size > to && text.length * size * ratio > maxWidth) size -= 1;
  return size;
}

/** Splits into at most `maxLines`, breaking on words, never mid-word. */
function wrap(text: string, maxWidth: number, size: number, ratio: number, maxLines: number): string[] {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * ratio)));
  if (text.length <= perLine) return [text];

  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > perLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  // Whatever is left goes on the last line, even if it overruns slightly —
  // truncating somebody's course title is worse than a tight line.
  const consumed = lines.join(" ").length;
  lines.push(consumed > 0 ? text.slice(consumed + 1) : current);
  return lines.slice(0, maxLines);
}

const longDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "";

/**
 * One decorative corner, drawn once and reflected into the other three.
 *
 * A rule that turns a corner and stops is what separates a certificate from a
 * box with text in it, and it costs four paths.
 */
function Corner({ x, y, flipX, flipY }: { x: number; y: number; flipX: boolean; flipY: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`}>
      <path
        d="M0 74 L0 26 Q0 0 26 0 L74 0"
        fill="none"
        stroke="url(#certGold)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M14 62 L14 30 Q14 14 30 14 L62 14"
        fill="none"
        stroke={NAVY}
        strokeWidth="0.9"
        opacity="0.4"
        strokeLinecap="round"
      />
      <circle cx="9" cy="9" r="3.4" fill="url(#certGold)" />
    </g>
  );
}

/** The rosette behind the Institute's mark — the thing that reads as a seal. */
function SealRosette({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  // A scalloped ring: 30 points alternating between two radii. Generated
  // rather than drawn by hand so it stays perfectly regular at any size.
  const points: string[] = [];
  const teeth = 30;
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (Math.PI * i) / teeth - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.925;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return <polygon points={points.join(" ")} fill="url(#certGold)" opacity="0.9" />;
}

/**
 * A signature block: the name in a hand, a rule, then who it was.
 *
 * The italic serif above the line is doing real work — a printed name over a
 * printed line reads as a form waiting to be signed, and the whole point of
 * this block is that the certificate is already signed.
 */
function Signature({
  cx,
  name,
  title,
  width = 250,
}: {
  cx: number;
  name: string;
  title: string;
  width?: number;
}) {
  const scriptSize = fit(name, width - 10, 32, 20, advance.serif);
  return (
    <g>
      <text
        x={cx}
        y={848}
        textAnchor="middle"
        fontFamily="'Instrument Serif', Georgia, serif"
        fontStyle="italic"
        fontSize={scriptSize}
        fill={NAVY_DEEP}
        opacity="0.9"
      >
        {name}
      </text>
      <line
        x1={cx - width / 2}
        y1={866}
        x2={cx + width / 2}
        y2={866}
        stroke={NAVY}
        strokeWidth="1"
        opacity="0.45"
      />
      <text
        x={cx}
        y={889}
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="12.5"
        fontWeight="600"
        letterSpacing="1.5"
        fill={NAVY_DEEP}
      >
        {name.toUpperCase()}
      </text>
      {title && (
        <text
          x={cx}
          y={907}
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontSize="11"
          letterSpacing="0.9"
          fill={INK_SOFT}
        >
          {title}
        </text>
      )}
    </g>
  );
}

export interface CertificateDocumentProps {
  certificate: CertificateDocument;
  /**
   * The Institute's mark, as a URL or a data URI.
   *
   * A data URI is what the export path passes, because a serialised SVG loaded
   * into an <img> for rasterising cannot fetch anything — an external reference
   * silently renders as nothing, and the first anybody would know is a
   * downloaded certificate with a hole where the logo was.
   */
  logoHref?: string;
  className?: string;
}

export const CertificateArtwork = forwardRef<SVGSVGElement, CertificateDocumentProps>(
  function CertificateArtwork(
    { certificate: c, logoHref = "/brand/ppship-emblem.png", className },
    ref,
  ) {
    // The QR is the expensive part of this render — a version-5 symbol is 37×37
    // modules walked eight times to pick a mask — and it depends on one string.
    const qr = useMemo(() => {
      try {
        const matrix = encodeQr(c.verification.url);
        return { modules: matrix.length, path: qrPath(matrix, 1) };
      } catch {
        // A verification URL long enough to overflow a version-10 symbol would
        // be a misconfiguration, not a certificate problem. The document still
        // prints, with its number and its written verification line, rather
        // than failing to render at all.
        return null;
      }
    }, [c.verification.url]);

    const copy = CERTIFICATE_KIND_COPY[c.kind];
    const revoked = c.status === "REVOKED";
    const archived = c.status === "ARCHIVED";

    const nameSize = fit(c.student.name, 1030, 62, 30, advance.display);
    const awardLines = wrap(c.award.title, 980, 33, advance.display, 2);
    const awardSize = awardLines.length > 1 ? 28 : fit(c.award.title, 980, 33, 22, advance.display);

    // The line under the course: whichever of these the certificate actually
    // knows. Joined with a separator rather than laid out in fixed slots, so a
    // manual certificate with no programme and no duration does not print two
    // orphaned bullets.
    const facts = [
      c.award.programme,
      c.durationText,
      c.completionDate ? `Completed ${longDate(c.completionDate)}` : null,
    ].filter((f): f is string => Boolean(f));

    const hasSignatory = Boolean(c.institute.signatoryName);
    const hasInstructor = Boolean(c.instructor);
    // Two signatures sit either side of centre; one sits ON centre. A single
    // block pushed off to the left with empty space beside it looks like
    // something failed to load.
    const instructorX = hasSignatory ? 545 : 707;
    const signatoryX = hasInstructor ? 869 : 707;

    return (
      <svg
        ref={ref}
        className={className ?? "certificate-doc"}
        viewBox={`0 0 ${CERT_WIDTH} ${CERT_HEIGHT}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`Certificate ${c.certificateNo}: ${copy.label} awarded to ${c.student.name} for ${c.award.title}, issued ${longDate(c.issuedAt)} by ${c.institute.name}.`}
      >
        <defs>
          {/* Gold, as a gradient rather than a flat fill. A single amber line
              reads as a coloured rule; a gradient reads as metal. */}
          <linearGradient id="certGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e6b355" />
            <stop offset="32%" stopColor="#f5a623" />
            <stop offset="62%" stopColor="#c07e12" />
            <stop offset="100%" stopColor="#f0c877" />
          </linearGradient>

          {/* A rule that fades out at both ends, so it frames the name rather
              than underlining it. */}
          <linearGradient id="certRule" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f5a623" stopOpacity="0" />
            <stop offset="22%" stopColor="#c07e12" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#f5a623" stopOpacity="1" />
            <stop offset="78%" stopColor="#c07e12" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#f5a623" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="certSealFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#24507a" />
            <stop offset="100%" stopColor={NAVY_DEEP} />
          </linearGradient>

          {/* Security-paper weave. Fine enough to read as texture rather than
              as stripes, and light enough not to touch the text contrast. */}
          <pattern
            id="certWeave"
            width="13"
            height="13"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="13" stroke={NAVY} strokeWidth="0.6" opacity="0.045" />
          </pattern>

          {/* The paper is not flat. A faint warm centre and cooler edges is
              what stops a large ivory rectangle looking like a blank page. */}
          <radialGradient id="certVignette" cx="50%" cy="42%" r="78%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="62%" stopColor="#fffdf8" stopOpacity="0" />
            <stop offset="100%" stopColor="#d8c9a8" stopOpacity="0.3" />
          </radialGradient>

          <clipPath id="certPage">
            <rect width={CERT_WIDTH} height={CERT_HEIGHT} />
          </clipPath>
        </defs>

        <g clipPath="url(#certPage)">
          {/* ------------------------------------------------------ paper -- */}
          <rect width={CERT_WIDTH} height={CERT_HEIGHT} fill={PAPER} />
          <rect width={CERT_WIDTH} height={CERT_HEIGHT} fill="url(#certWeave)" />
          <rect width={CERT_WIDTH} height={CERT_HEIGHT} fill="url(#certVignette)" />

          {/* The Institute's mark, enormous and almost invisible. This is what
              a watermark is for: it belongs to the paper, not to the layout. */}
          <image
            href={logoHref}
            x={707 - 230}
            y={520 - 230}
            width={460}
            height={460}
            opacity="0.045"
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Two soft navy washes, top-left and bottom-right. They give the
              sheet a direction of light without putting anything on it. */}
          <path d="M0 0 L360 0 L0 300 Z" fill={NAVY} opacity="0.045" />
          <path
            d={`M${CERT_WIDTH} ${CERT_HEIGHT} L${CERT_WIDTH - 360} ${CERT_HEIGHT} L${CERT_WIDTH} ${CERT_HEIGHT - 300} Z`}
            fill={NAVY}
            opacity="0.045"
          />

          {/* ----------------------------------------------------- frame -- */}
          <rect
            x="28"
            y="28"
            width={CERT_WIDTH - 56}
            height={CERT_HEIGHT - 56}
            fill="none"
            stroke="url(#certGold)"
            strokeWidth="3"
          />
          <rect
            x="42"
            y="42"
            width={CERT_WIDTH - 84}
            height={CERT_HEIGHT - 84}
            fill="none"
            stroke={NAVY}
            strokeWidth="1"
            opacity="0.3"
          />

          <Corner x={28} y={28} flipX={false} flipY={false} />
          <Corner x={CERT_WIDTH - 28} y={28} flipX flipY={false} />
          <Corner x={28} y={CERT_HEIGHT - 28} flipX={false} flipY />
          <Corner x={CERT_WIDTH - 28} y={CERT_HEIGHT - 28} flipX flipY />

          {/* ---------------------------------------------------- header -- */}
          <image href={logoHref} x={707 - 39} y="70" width="78" height="78" preserveAspectRatio="xMidYMid meet" />

          <text
            x="707"
            y="192"
            textAnchor="middle"
            fontFamily="Sora, sans-serif"
            fontSize={fit(c.institute.name, 900, 27, 17, 0.72)}
            fontWeight="600"
            letterSpacing="5.5"
            fill={NAVY}
          >
            {c.institute.name.toUpperCase()}
          </text>

          {/* Omitted rather than printed blank. An empty line under the name
              looks like something failed. */}
          {c.institute.tagline && (
            <text
              x="707"
              y="216"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize="12"
              letterSpacing="3.4"
              fill={INK_SOFT}
            >
              {c.institute.tagline.toUpperCase()}
            </text>
          )}

          {/* A diamond between two hairlines — the join that says "this is a
              document" without adding a single word. */}
          <g transform={`translate(707 ${c.institute.tagline ? 242 : 226})`}>
            <line x1="-124" y1="0" x2="-16" y2="0" stroke="url(#certRule)" strokeWidth="1.6" />
            <line x1="16" y1="0" x2="124" y2="0" stroke="url(#certRule)" strokeWidth="1.6" />
            <path d="M0 -6 L6 0 L0 6 L-6 0 Z" fill="url(#certGold)" />
          </g>

          {/* ----------------------------------------------------- title -- */}
          <text
            x="707"
            y="332"
            textAnchor="middle"
            fontFamily="Sora, sans-serif"
            fontSize="64"
            fontWeight="700"
            letterSpacing="15"
            fill={NAVY_DEEP}
          >
            {copy.title.toUpperCase()}
          </text>
          <text
            x="707"
            y="368"
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
            fontSize="18"
            fontWeight="600"
            letterSpacing="11"
            fill={GOLD_DEEP}
          >
            {copy.subtitle.toUpperCase()}
          </text>

          {/* --------------------------------------------------- the name -- */}
          <text
            x="707"
            y="440"
            textAnchor="middle"
            fontFamily="'Instrument Serif', Georgia, serif"
            fontStyle="italic"
            fontSize="23"
            fill={INK_SOFT}
          >
            This is to certify that
          </text>

          {/* THE STRONGEST THING ON THE PAGE, and it should be. Everything
              above is the Institute talking about itself; this is the person
              the document is about. */}
          <text
            x="707"
            y="514"
            textAnchor="middle"
            fontFamily="Sora, sans-serif"
            fontSize={nameSize}
            fontWeight="600"
            fill={NAVY_DEEP}
          >
            {c.student.name}
          </text>
          <rect x="427" y="536" width="560" height="2.2" fill="url(#certRule)" />

          {/* Only when there is one. A registration number is the first thing
              an employer checks against, and a blank line where it should be
              is worse than no line. */}
          {c.student.registrationNo && (
            <text
              x="707"
              y="562"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize="12"
              letterSpacing="2.6"
              fill={INK_SOFT}
            >
              {`REGISTRATION NO. ${c.student.registrationNo}`}
            </text>
          )}

          {/* -------------------------------------------------- the award -- */}
          <text
            x="707"
            y={c.student.registrationNo ? 604 : 596}
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
            fontSize="15.5"
            letterSpacing="0.7"
            fill={INK_SOFT}
          >
            {copy.statement}
          </text>

          {awardLines.map((line, i) => (
            <text
              key={line}
              x="707"
              y={(c.student.registrationNo ? 648 : 640) + i * (awardSize + 8)}
              textAnchor="middle"
              fontFamily="Sora, sans-serif"
              fontSize={awardSize}
              fontWeight="600"
              fill={NAVY}
            >
              {line}
            </text>
          ))}

          {facts.length > 0 && (
            <text
              x="707"
              y={(c.student.registrationNo ? 684 : 676) + (awardLines.length - 1) * (awardSize + 8)}
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize="13"
              letterSpacing="1.3"
              fill={INK_SOFT}
            >
              {facts.join("   ·   ")}
            </text>
          )}

          {/* ---------------------------------------------------- footer -- */}
          <line x1="150" y1="742" x2={CERT_WIDTH - 150} y2="742" stroke={NAVY} strokeWidth="1" opacity="0.16" />

          {/* The QR, left. On white with a real quiet zone, because a code
              printed hard against a border is a code that does not scan. */}
          {qr && (
            <g transform="translate(150 766)">
              <rect
                x="-6"
                y="-6"
                width="120"
                height="120"
                rx="4"
                fill="#ffffff"
                stroke={NAVY}
                strokeWidth="0.8"
                opacity="0.9"
              />
              <g transform={`scale(${108 / (qr.modules + 4)}) translate(2 2)`}>
                <path d={qr.path} fill={NAVY_DEEP} />
              </g>
              <text
                x="54"
                y="136"
                textAnchor="middle"
                fontFamily="Inter, sans-serif"
                fontSize="9"
                fontWeight="600"
                letterSpacing="2.2"
                fill={INK_SOFT}
              >
                SCAN TO VERIFY
              </text>
            </g>
          )}

          {hasInstructor && c.instructor && (
            <Signature cx={instructorX} name={c.instructor.name} title={c.instructor.title} />
          )}
          {hasSignatory && (
            <Signature
              cx={signatoryX}
              name={c.institute.signatoryName}
              title={c.institute.signatoryTitle}
            />
          )}

          {/* The seal, right. It balances the QR and it is the one element
              here whose only job is to say "this is official". */}
          <g>
            <SealRosette cx={1214} cy={826} r={64} />
            <circle cx="1214" cy="826" r="53" fill="url(#certSealFace)" />
            <circle cx="1214" cy="826" r="46" fill="none" stroke="#f5a623" strokeWidth="0.9" opacity="0.6" />
            <image href={logoHref} x="1189" y="794" width="50" height="40" preserveAspectRatio="xMidYMid meet" />
            <text
              x="1214"
              y="852"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize="7.5"
              fontWeight="600"
              letterSpacing="1.9"
              fill="#f5d9a6"
            >
              OFFICIAL SEAL
            </text>
            <text
              x="1214"
              y="864"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize="6.5"
              letterSpacing="1.2"
              fill="#c9d6e4"
            >
              {new Date(c.issuedAt).getFullYear()}
            </text>
          </g>

          {/* ------------------------------------------------ bottom bar -- */}
          <line x1="150" y1="928" x2={CERT_WIDTH - 150} y2="928" stroke={NAVY} strokeWidth="0.8" opacity="0.14" />

          <text
            x="150"
            y="950"
            fontFamily="Inter, sans-serif"
            fontSize="11.5"
            letterSpacing="0.6"
            fill={INK_SOFT}
          >
            Certificate ID
            <tspan fontWeight="600" fill={NAVY_DEEP} letterSpacing="1.1">
              {`  ${c.certificateNo}`}
            </tspan>
          </text>

          {c.institute.website && (
            <text
              x="707"
              y="950"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize="11"
              letterSpacing="1.4"
              fill={INK_SOFT}
            >
              {c.institute.website}
            </text>
          )}

          <text
            x={CERT_WIDTH - 150}
            y="950"
            textAnchor="end"
            fontFamily="Inter, sans-serif"
            fontSize="11.5"
            letterSpacing="0.6"
            fill={INK_SOFT}
          >
            Issued
            <tspan fontWeight="600" fill={NAVY_DEEP}>
              {`  ${longDate(c.issuedAt)}`}
            </tspan>
          </text>

          {/*
            A REVOKED CERTIFICATE SAYS SO ON ITS FACE.

            The public verification page tells an employer the truth, but only
            if they check. A downloaded PDF travels on its own, and one that
            looked identical to a valid certificate would be a forgery this
            System had helpfully produced. The band is unmissable and survives
            printing in black and white.
          */}
          {(revoked || archived) && (
            <g opacity={revoked ? 0.92 : 0.7}>
              <rect
                x="-200"
                y="452"
                width={CERT_WIDTH + 400}
                height="96"
                fill={revoked ? "#b91c1c" : NAVY}
                opacity="0.14"
                transform="rotate(-14 707 500)"
              />
              <text
                x="707"
                y="516"
                textAnchor="middle"
                fontFamily="Sora, sans-serif"
                fontSize="86"
                fontWeight="700"
                letterSpacing="20"
                fill={revoked ? "#b91c1c" : NAVY}
                opacity="0.4"
                transform="rotate(-14 707 500)"
              >
                {revoked ? "REVOKED" : "ARCHIVED"}
              </text>
            </g>
          )}
        </g>
      </svg>
    );
  },
);
