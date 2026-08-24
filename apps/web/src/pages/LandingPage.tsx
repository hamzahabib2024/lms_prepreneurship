import { Fragment, useEffect, useState } from "react";
import { Skeleton } from "../components/Ui";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Icon } from "../components/Icon";
import { CourseCover } from "../components/CourseCover";
import {
  VideoWall,
  PhotoStrip,
  NewsList,
  SocialRow,
  type VideoLink,
  type ImageLink,
  type NewsItem,
} from "../components/VideoWall";

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
 *
 * AND THE WORDS ARE NOT IN THIS FILE ANY MORE. The headline, the paragraph
 * under it, the two buttons, the six cards, four section headings and the
 * closing band were string literals here — correct on the day they were
 * written and changeable only by a developer with a deployment, which is how a
 * front page comes to describe an Institute as it was two years ago. They come
 * from `/public/showcase` now, edited on the Public page screen by an Admin.
 *
 * THE DEFAULTS ARE THE WORDS THAT WERE HERE, declared in the settings
 * catalogue, so an Institute that changes nothing gets exactly the page this
 * file used to render — and the fallbacks below cover the one case that is
 * left: the showcase request failing outright, where a headline is better than
 * a blank screen.
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

/** What the Institute has written on its own front page. */
interface Copy {
  heroPill: string;
  heroHeadline: string;
  heroBody: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  showStats: boolean;
  showFeatures: boolean;
  features: { icon: string; title: string; body: string }[];
  videosHeading: string;
  videosBlurb: string;
  newsHeading: string;
  newsBlurb: string;
  programmesHeading: string;
  programmesBlurb: string;
  closingHeading: string;
  closingBody: string;
  closingCta: string;
}

interface Showcase {
  instituteName: string;
  tagline: string | null;
  videos: VideoLink[];
  images: ImageLink[];
  news: NewsItem[];
  copy: Copy;
  social: { platform: string; url: string }[];
}

/**
 * THE PAGE STILL RENDERS WHEN THE SHOWCASE REQUEST FAILS.
 *
 * A network blip, a restarting API, a setting stored as the wrong shape: any
 * of them would otherwise leave a visitor looking at a page with no headline
 * and two unlabelled buttons, which reads as a broken site rather than as one
 * fact that did not load. These are the same words the settings catalogue
 * declares as its defaults — the words that were compiled into this file
 * before the Institute could edit them.
 */
const FALLBACK: Copy = {
  heroPill: "Prepreneurship Institute",
  heroHeadline: "Learn the craft.\nBuild the business.",
  heroBody:
    "Practical programmes in design and digital marketing, taught in small sections with " +
    "attendance, coursework and progress you can see from the first week — not a mark at the " +
    "end of the term.",
  heroPrimaryCta: "Apply now",
  heroSecondaryCta: "See what we teach",
  showStats: true,
  showFeatures: false,
  // Empty rather than duplicated. The six cards live in the catalogue; copying
  // them here would be a second version to keep in step, and a page that is
  // missing one section because the server is down is honest — a page showing
  // six claims the Institute may since have changed is not.
  features: [],
  videosHeading: "See what we do",
  videosBlurb: "Straight from our own channels. Nothing plays until you press it.",
  newsHeading: "Latest from the Institute",
  newsBlurb: "Notices we have published for everyone.",
  programmesHeading: "What we are running",
  programmesBlurb: "Straight from the Institute's own records — if a section is listed, it is open.",
  closingHeading: "Ready when you are.",
  closingBody:
    "Applications are open. Fill the form, attach your slip, and we will write to you with a " +
    "tracking reference you can check at any time.",
  closingCta: "Start your application",
};

export function LandingPage() {
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [showcase, setShowcase] = useState<Showcase | null>(null);

  // One name for "what this page says", whether it came from the Institute or
  // from the fallback, so nothing below has to ask which.
  const copy = showcase?.copy ?? FALLBACK;

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
          <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
          Prepreneurship
        </span>
        <nav className="row-actions">
          <a className="btn btn-quiet" href="#programmes">
            Programmes
          </a>
          {/* FR-REG-020 — in the nav, not buried in the footer. Somebody who
              has already applied arrives at this page for exactly one reason,
              and until now the page had nothing for them: it promised a
              reference they could check at any time and offered nowhere to
              check it. */}
          <Link className="btn btn-quiet" to="/track">
            Track application
          </Link>
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
          <span className="pill hero-pill">{copy.heroPill}</span>
          {/* Each line of the headline on its own line, because that is how it
              was typed and how somebody laying out two short phrases means them
              to break. A single long line still renders as one. */}
          <h1>
            {copy.heroHeadline.split("\n").map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </h1>
          <p>{copy.heroBody}</p>
          <div className="row-actions">
            <Link className="btn btn-primary btn-lg" to="/apply">
              {copy.heroPrimaryCta}
            </Link>
            <a className="btn btn-lg" href="#programmes">
              {copy.heroSecondaryCta}
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
              <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
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

      {/*
        COUNTED, NOT CLAIMED. Every figure here comes from the prospectus that
        was just loaded, so it is whatever the Institute actually has today and
        cannot drift. The band renders only once there is something to count —
        "0 programmes" on a front page is worse than no band at all.
      */}
      {copy.showStats && programmes && programmes.length > 0 && (
        <section className="stat-band">
          <div className="landing-inner stat-band-inner">
            <div className="stat-item">
              <strong>{programmes.length}</strong>
              <span>{programmes.length === 1 ? "programme" : "programmes"}</span>
            </div>
            <div className="stat-item">
              <strong>{programmes.reduce((n, p) => n + p.sections.length, 0)}</strong>
              <span>sections open now</span>
            </div>
            <div className="stat-item">
              <strong>
                {new Set(programmes.flatMap((p) => p.sections.map((s) => s.shift))).size}
              </strong>
              <span>shifts to choose from</span>
            </div>
            <div className="stat-item">
              <strong>0</strong>
              {/* The one figure worth boasting about, and it is true: the
                  application form needs no account. */}
              <span>accounts needed to apply</span>
            </div>
          </div>
        </section>
      )}

      {/* Off, or empty, and the band goes entirely — an institute that would
          rather not make six claims should not be left with an empty grid. */}
      {copy.showFeatures && copy.features.length > 0 && (
        <section className="landing-band">
          <div className="landing-inner">
            <div className="feature-grid">
              {copy.features.map((f) => (
                <Feature key={f.title} icon={f.icon} title={f.title}>
                  {f.body}
                </Feature>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Above the programme list on purpose: somebody deciding whether to
          apply wants to see the place before they read a table of shifts. */}
      {showcase && (
        <VideoWall videos={showcase.videos} heading={copy.videosHeading} blurb={copy.videosBlurb} />
      )}
      {showcase && <PhotoStrip images={showcase.images} />}
      {showcase && (
        <NewsList news={showcase.news} heading={copy.newsHeading} blurb={copy.newsBlurb} />
      )}

      <section className="landing-inner" id="programmes">
        <header className="page-head">
          <div>
            <h2 className="landing-h2">{copy.programmesHeading}</h2>
            <p className="muted">{copy.programmesBlurb}</p>
          </div>
        </header>

        {programmes === null ? (
          <Skeleton lines={2} />
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
                {/* Drawn from the course's own code, so it is the same artwork
                    here, on the apply form and in a student's subject list. */}
                <CourseCover code={p.code} name={p.name} />

                <div className="programme-body">
                  <div className="programme-meta">
                    <span className="pill">{p.code}</span>
                    {p.durationWeeks && (
                      <span className="pill pill-ok">
                        {/* Months, because that is how somebody decides
                            whether they can commit to it. 4.33 weeks a month. */}
                        {Math.round(p.durationWeeks / 4.33)} months
                      </span>
                    )}
                    <span className="pill">
                      {p.sections.length} {p.sections.length === 1 ? "section" : "sections"} open
                    </span>
                  </div>
                  <h3>{p.name}</h3>
                  {p.description && <p className="muted small">{p.description}</p>}

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

                  <Link className="btn btn-primary programme-cta" to="/apply">
                    Apply for {p.code}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* The button exists now, and so does the form behind it. */}
        <div className="row-actions">
          <Link className="btn btn-primary btn-lg" to="/apply">
            {copy.heroPrimaryCta}
          </Link>
          <span className="muted small">
            No account needed. About five minutes, and a photo of your payment slip.
          </span>
        </div>
      </section>

      {/*
        The last thing on the page, because somebody who has read this far has
        decided and should not have to scroll back up to act on it. It repeats
        the one instruction that matters and nothing else — a closing band that
        restates the whole page is a page nobody finished reading.
      */}
      <section className="closing-band">
        <div className="landing-inner closing-inner">
          <div>
            <h2>{copy.closingHeading}</h2>
            <p>{copy.closingBody}</p>
            {/* The promise in the sentence above, made good. */}
            <p className="small">
              Already applied? <Link to="/track">Check your application</Link>.
            </p>
          </div>
          <Link className="btn btn-lg closing-cta" to="/apply">
            {copy.closingCta}
          </Link>
        </div>
      </section>

      <footer className="landing-foot">
        <div className="landing-inner landing-foot-inner">
          <span className="auth-logo">
            <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
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
