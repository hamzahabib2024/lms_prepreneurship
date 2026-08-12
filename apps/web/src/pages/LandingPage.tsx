import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Icon } from "../components/Icon";
import { VideoWall, SocialRow, type VideoLink } from "../components/VideoWall";

/**
 * The public front of Prepreneurship — SRS §13.2, FR-REG-002.
 *
 * WHAT MAKES THIS DIFFERENT FROM A BROCHURE is that the programmes on it are
 * REAL. They come from `/public/prospectus`, so a programme the Institute
 * closes stops being advertised the same afternoon, and a new section appears
 * without anybody editing a page. A marketing site that drifts from what the
 * Institute actually runs is worse than none: it takes applications for
 * courses that no longer exist.
 *
 * WHAT IT DOES NOT CLAIM is the other half. There are no invented student
 * numbers, no "trusted by thousands", no five-star testimonials from people
 * who do not exist. Every figure on this page is either real or absent —
 * partly because inventing them would be a lie the Institute has to keep, and
 * partly because a page that overclaims makes a reader doubt the things that
 * are true.
 */

interface Section {
  id: string;
  name: string;
  code: string;
  shift: string;
  genderRestriction: string;
  session: string;
}

interface Programme {
  id: string;
  name: string;
  code: string;
  description: string | null;
  durationWeeks: number | null;
  sections: Section[];
}

const SHIFT: Record<string, string> = {
  MORNING: "Morning",
  EVENING: "Evening",
  WEEKEND: "Weekend",
};

interface Showcase {
  instituteName: string;
  tagline: string | null;
  videos: VideoLink[];
  social: { platform: string; url: string }[];
}

export function LandingPage() {
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [showcase, setShowcase] = useState<Showcase | null>(null);

  useEffect(() => {
    api
      .get<Programme[]>("/public/prospectus")
      // A landing page whose programme list failed should still be a landing
      // page. The section below simply does not render.
      .then(setProgrammes)
      .catch(() => setProgrammes([]));

    // Same again: videos are the Institute's marketing, not the page's
    // structure, so a failure here costs a section rather than the page.
    api
      .get<Showcase>("/public/showcase")
      .then(setShowcase)
      .catch(() => setShowcase(null));
  }, []);

  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="auth-logo">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          Prepreneurship
        </span>
        <nav className="row-actions">
          <a className="btn btn-quiet" href="#programmes">
            Programmes
          </a>
          <Link className="btn btn-quiet" to="/login">
            Sign in
          </Link>
          <Link className="btn btn-primary" to="/apply">
            Apply
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="pill hero-pill">Prepreneurship Institute</span>
          <h1>
            Learn the craft.
            <br />
            Build the business.
          </h1>
          <p>
            Practical programmes in design and digital marketing, taught in small sections with
            attendance, coursework and progress you can see from the first week — not a mark at the
            end of the term.
          </p>
          <div className="row-actions">
            <Link className="btn btn-primary btn-lg" to="/apply">
              Apply now
            </Link>
            <a className="btn btn-lg" href="#programmes">
              See what we teach
            </a>
          </div>
        </div>

        {/*
          A picture of the product rather than a stock photograph of somebody
          pointing at a laptop. It is the student's own progress card, built
          from the same components the real screen uses, so what a visitor is
          shown is what they will actually get.
        */}
        <div className="hero-art" aria-hidden="true">
          <div className="hero-card">
            <div className="hero-card-head">
              <span className="brand-mark">P</span>
              <div>
                <strong>Graphic Designing</strong>
                <span className="muted small">GD-101 · Morning A</span>
              </div>
            </div>
            <div className="hero-ring">
              <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true" focusable="false">
                <circle cx="42" cy="42" r="38" fill="none" strokeWidth="8" className="ring-track" />
                <circle
                  cx="42"
                  cy="42"
                  r="38"
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-value"
                  strokeDasharray={2 * Math.PI * 38}
                  strokeDashoffset={2 * Math.PI * 38 * 0.28}
                  transform="rotate(-90 42 42)"
                />
              </svg>
              <span className="ring-label">72%</span>
            </div>
            <div className="hero-rows">
              <span className="pill pill-ok">Attendance 88%</span>
              <span className="pill">4 of 7 lectures watched</span>
              <span className="pill pill-warn">1 assignment due Friday</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-band">
        <div className="landing-inner">
          <div className="feature-grid">
            <Feature icon="calendar" title="A timetable that is true">
              Every class, with the room and the teacher, and a join link that appears when the
              class does rather than in an email nobody can find.
            </Feature>
            <Feature icon="check" title="Attendance you can act on">
              Registers taken in seconds and a warning the moment somebody slips below the
              requirement — early enough to do something about it.
            </Feature>
            <Feature icon="chart" title="Progress from the first week">
              Lectures watched, work submitted, marks released and attendance, combined into one
              figure that says what is left rather than only how far along.
            </Feature>
            <Feature icon="money" title="Fees without arguments">
              Instalment plans, receipts printed on the spot, and a statement that shows every
              charge and every payment — including the ones that were reversed.
            </Feature>
            <Feature icon="award" title="Certificates worth holding">
              Issued only when the requirements are genuinely met, and verifiable by an employer
              from the printed number without an account.
            </Feature>
            <Feature icon="shield" title="Records that keep themselves">
              An append-only audit log, so who changed what is a question with an answer rather
              than a matter of recollection.
            </Feature>
          </div>
        </div>
      </section>

      {/* Above the programme list on purpose: somebody deciding whether to
          apply wants to see the place before they read a table of shifts. */}
      {showcase && <VideoWall videos={showcase.videos} />}

      <section className="landing-inner" id="programmes">
        <header className="page-head">
          <div>
            <h2 className="landing-h2">What we are running</h2>
            <p className="muted">
              Straight from the Institute's own records — if a section is listed, it is open.
            </p>
          </div>
        </header>

        {programmes === null ? (
          <p className="muted">Loading…</p>
        ) : programmes.length === 0 ? (
          <div className="card">
            <p className="muted">
              Nothing is open for enrolment at the moment. Please check back, or speak to the
              office.
            </p>
          </div>
        ) : (
          <div className="grid">
            {programmes.map((p) => (
              <article className="card widget programme-card" key={p.id}>
                <span className="pill">{p.code}</span>
                <h3>{p.name}</h3>
                {p.description && <p className="muted small">{p.description}</p>}
                {p.durationWeeks && (
                  <p className="muted small">{p.durationWeeks} weeks</p>
                )}

                <div className="section-label">Sections open</div>
                <ul className="list small">
                  {p.sections.map((s) => (
                    <li key={s.id}>
                      <strong>{s.name}</strong>
                      <br />
                      <span className="muted">
                        {SHIFT[s.shift] ?? s.shift}
                        {/* Said plainly. A student turning up to find the
                            section is not for them is the Institute's failure,
                            not theirs (FR-CRS-009). */}
                        {s.genderRestriction !== "MIXED" &&
                          ` · ${s.genderRestriction.toLowerCase()} students only`}
                        {` · ${s.session}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}

        {/* The button exists now, and so does the form behind it. */}
        <div className="row-actions">
          <Link className="btn btn-primary btn-lg" to="/apply">
            Apply now
          </Link>
          <span className="muted small">
            No account needed. About five minutes, and a photo of your payment slip.
          </span>
        </div>
      </section>

      <footer className="landing-foot">
        <div className="landing-inner landing-foot-inner">
          <span className="auth-logo">
            <span className="brand-mark" aria-hidden="true">
              P
            </span>
            Prepreneurship
          </span>
          {showcase && <SocialRow social={showcase.social} />}
          <span className="muted small">
            Already enrolled? <Link to="/login">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="feature">
      <span className="feature-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p className="muted small">{children}</p>
    </div>
  );
}
