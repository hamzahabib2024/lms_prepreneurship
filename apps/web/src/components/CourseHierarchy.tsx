import { Icon } from "./Icon";

/**
 * WHAT THESE THREE WORDS MEAN — shown once, at the top of the Courses screen.
 *
 * THE PROBLEM THIS SOLVES IS NOT DECORATIVE. An administrator opening this
 * System for the first time meets Programmes, Terms, Batches, Sections and
 * Subjects — five nouns, four of which sound like they could mean the same
 * thing, spread across three screens, each refusing to work until something on
 * another screen exists. The order is never stated anywhere. People either
 * learn it from somebody who already knows, or they create a Subject, look for
 * where to put students in it, and stop.
 *
 * Three levels are shown because three is what an administrator actually
 * thinks in: subjects are taught, a course is a set of them, and a course runs
 * as several batches. The System's Term and delivery-group layers still exist
 * and are still editable under Structure — they are simply not a prerequisite
 * any more, so they are not something to learn before starting.
 *
 * IT IS A DIAGRAM RATHER THAN A PARAGRAPH because the relationship is the
 * thing being explained, and prose describing a tree is harder than the tree.
 */
export function CourseHierarchy({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "hierarchy hierarchy-compact" : "hierarchy"}>
      <div className="hierarchy-intro">
        <h2>How a course fits together</h2>
        <p className="muted small">
          Three things, in this order. Everything on this page is one of them.
        </p>
      </div>

      <ol className="hierarchy-steps">
        <li className="hierarchy-step">
          <span className="hierarchy-num">1</span>
          <div>
            <strong>
              <Icon name="book" /> Subjects
            </strong>
            <p className="muted small">
              A single thing that is taught — <em>Adobe Photoshop</em>, <em>English</em>. Made
              once, then used by any course that teaches it.
            </p>
          </div>
        </li>

        <li className="hierarchy-arrow" aria-hidden="true">
          <Icon name="chevron-right" />
        </li>

        <li className="hierarchy-step">
          <span className="hierarchy-num">2</span>
          <div>
            <strong>
              <Icon name="layers" /> Course
            </strong>
            <p className="muted small">
              What a student applies for — <em>Diploma in Graphic Designing</em>. It has a fee, a
              picture on the public page, and the subjects taught in it.
            </p>
          </div>
        </li>

        <li className="hierarchy-arrow" aria-hidden="true">
          <Icon name="chevron-right" />
        </li>

        <li className="hierarchy-step">
          <span className="hierarchy-num">3</span>
          <div>
            <strong>
              <Icon name="users" /> Batches
            </strong>
            <p className="muted small">
              The actual group of students — <em>Morning A (Female)</em>, <em>Batch 2</em>. One
              course can run as many batches at once, each with its own seats and timetable.
            </p>
          </div>
        </li>
      </ol>

      {!compact && (
        <p className="hierarchy-example small">
          <strong>For example:</strong> <em>Photoshop</em> and <em>English</em> are{" "}
          <strong>subjects</strong>. Together they make the <strong>course</strong>{" "}
          <em>Diploma in Graphic Designing</em>. That course runs as two <strong>batches</strong> —
          one female, one male — both teaching the same subjects.
        </p>
      )}
    </section>
  );
}

/**
 * The one-line version, for a screen that is not the Courses page.
 *
 * Sections and Structure still exist and still edit the layers underneath, and
 * somebody arriving there from a link needs to know where they are in the same
 * three words rather than a different four.
 */
export function HierarchyCrumb({ level }: { level: "subject" | "course" | "batch" }) {
  const at = (l: string) => (l === level ? "crumb-here" : "crumb");
  return (
    <p className="hierarchy-crumb small">
      <span className={at("subject")}>Subjects</span>
      <Icon name="chevron-right" />
      <span className={at("course")}>Course</span>
      <Icon name="chevron-right" />
      <span className={at("batch")}>Batches</span>
    </p>
  );
}
