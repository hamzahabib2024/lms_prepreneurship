import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { EmptyState, ErrorState, Skeleton } from "../components/Ui";
import { HowItWorks } from "../components/HowItWorks";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { StepUpPrompt, needsStepUp } from "../components/StepUpPrompt";

/**
 * PARTNER INSTITUTES — the office side. SRS §9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN IS FOR. Another institute sends us students. We teach them,
 * mark them and certify them — they are fully our students — but the institute
 * that sent them has a legitimate interest in how they are getting on, and
 * usually pays us for them. This is where that relationship is recorded, and
 * where somebody from that institute is given an account to see their own
 * people and nobody else's.
 *
 * THE TWO ACTS ON THIS PAGE ARE NOT EQUALLY DANGEROUS, and the layout says so.
 * Adding an institute is bookkeeping. GIVING SOMEBODY AN ACCOUNT hands a
 * person who does not work here the ability to read student records, so it
 * sits behind its own disclosure on the row it belongs to, names the institute
 * in the confirmation, and shows the temporary password once.
 *
 * BILLING MODE IS THE FIELD PEOPLE GET WRONG, so it is not a bare dropdown.
 * Each option says what will actually happen to the money, because the
 * consequence lands on students who are not in the room: under PARTNER_PAYS
 * no charge is ever raised against them, so they owe nothing, appear on no
 * debtors list and are offered no payment button. Choosing it by accident for
 * an institute whose students pay us directly means nobody is ever billed at
 * all, and the first sign of it is an empty ledger at the end of term.
 *
 * WHY THE MODE IS NOT EDITABLE HERE ONCE STUDENTS EXIST — it is, but the
 * warning is loud. The payer is snapshotted onto each student at admission
 * (BR-DAT-02), so changing it changes what happens to the NEXT intake and
 * leaves last term's students exactly as they were. That is the correct
 * behaviour and it is the opposite of what somebody expects from a dropdown,
 * which is why it is written on the screen rather than left to be discovered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Partner {
  id: string;
  name: string;
  code: string;
  city: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingMode: "PARTNER_PAYS" | "STUDENT_PAYS";
  isActive: boolean;
  studentCount: number;
  billingLabel: string;
}

interface NewAccount {
  id: string;
  email: string;
  fullName: string;
  temporaryPassword?: string;
  /** Whether the mail server accepted it — never whether it was read. */
  emailSent?: boolean;
  emailDetail?: string;
}

export function PartnersPage() {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Which row has its account panel open. One at a time, deliberately. */
  const [accountFor, setAccountFor] = useState<string | null>(null);
  /** And which is being invoiced. Also one at a time, and never both. */
  const [billingFor, setBillingFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPartners(await api.get<Partner[]>("/partners"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The institutes could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Partner institutes</h1>
          <p className="muted small">
            Other institutes whose students we teach. Their staff can be given an account to see
            their own students&rsquo; results — and nobody else&rsquo;s.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add an institute"}
        </button>
      </header>

      <HowItWorks
        id="partners"
        title="How a partner institute works"
        steps={[
          {
            icon: "link",
            title: "Record the institute",
            body: "Its name, a short code for invoices, and who pays us — the institute or the students themselves.",
          },
          {
            icon: "upload",
            title: "Import their students",
            body: "On the Import screen, choose the institute before the file. The preview says what will happen to the money.",
          },
          {
            icon: "key",
            title: "Give their coordinator an account",
            body: "They see their own students, released results, attendance and certificates. They can change nothing.",
          },
        ]}
        note="A partner sees only their own students. They never see our other students, anyone's payment history, unreleased marks, or that any other partner institute exists."
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {adding && (
        <AddPartner
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {!partners && !error && <Skeleton lines={5} />}

      {partners && partners.length === 0 && !adding && (
        <EmptyState icon="link" title="No partner institutes yet">
          When another institute sends us a group of students, record it here first. Then their
          students can be imported against it and their coordinator given an account.
        </EmptyState>
      )}

      {partners && partners.length > 0 && (
        <section className="card">
          <ul className="list">
            {partners.map((p) => (
              <li key={p.id} className="assignment">
                <div className="assignment-head">
                  <div>
                    <strong>{p.name}</strong>{" "}
                    <span className="muted small">({p.code})</span>
                    {p.city && <span className="muted small"> · {p.city}</span>}
                  </div>
                  <span className="row-actions">
                    {/*
                      THE BILLING MODE AS A PILL, in words rather than the
                      enum. "PARTNER_PAYS" is a database value; "We invoice the
                      institute" is the thing somebody needs to check at a
                      glance before importing two hundred students against it.
                    */}
                    <span className={p.billingMode === "PARTNER_PAYS" ? "pill pill-ok" : "pill"}>
                      {p.billingLabel}
                    </span>
                    {!p.isActive && <span className="pill pill-warn">Inactive</span>}
                  </span>
                </div>

                <p className="muted small">
                  {p.studentCount === 0
                    ? "No students imported yet."
                    : `${p.studentCount} student${p.studentCount === 1 ? "" : "s"}`}
                  {p.contactName && ` · ${p.contactName}`}
                  {p.contactEmail && ` · ${p.contactEmail}`}
                  {p.contactPhone && ` · ${p.contactPhone}`}
                </p>

                <div className="row-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setAccountFor(accountFor === p.id ? null : p.id);
                      setBillingFor(null);
                    }}
                  >
                    {accountFor === p.id ? "Close" : "Give someone an account"}
                  </button>
                  {/* OFFERED ONLY WHEN THERE IS SOMETHING TO BILL. A
                      STUDENT_PAYS institute is never invoiced — their students
                      pay us directly — so the button does not exist rather
                      than existing and refusing. */}
                  {p.billingMode === "PARTNER_PAYS" && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setBillingFor(billingFor === p.id ? null : p.id);
                        setAccountFor(null);
                      }}
                    >
                      {billingFor === p.id ? "Close" : "Raise an invoice"}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-quiet"
                    onClick={() => {
                      void (async () => {
                        try {
                          await api.patch(`/partners/${p.id}`, { isActive: !p.isActive });
                          await load();
                        } catch (e) {
                          setError(
                            e instanceof ApiError ? e.message : "That change could not be saved.",
                          );
                        }
                      })();
                    }}
                  >
                    {p.isActive ? "Mark inactive" : "Reactivate"}
                  </button>
                </div>

                {accountFor === p.id && <GiveAccount partner={p} />}
                {billingFor === p.id && (
                  <RaiseInvoice
                    partner={p}
                    onDone={() => {
                      void load();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/* ========================================================================== *
 *  ADDING AN INSTITUTE
 * ========================================================================== */

function AddPartner({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [billingMode, setBillingMode] = useState<"PARTNER_PAYS" | "STUDENT_PAYS">("PARTNER_PAYS");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/partners", {
        name: name.trim(),
        code: code.trim(),
        billingMode,
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
        ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That institute could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>A new partner institute</h2>
      </div>

      {error && <ErrorState message={error} />}

      <div className="form-row">
        <Field label="Name of the institute" required>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field
          label="Short code"
          required
          hint="Letters, digits and hyphens. It prints on invoices and gets read down a telephone, so keep it short."
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
        </Field>
      </div>

      {/*
        WHO PAYS US — asked as two described choices rather than a dropdown,
        because the consequence is invisible and lands on students who are not
        in the room. See the note at the top of this file.
      */}
      <fieldset className="priority-picker">
        <legend className="field-label">Who pays us for these students?</legend>
        <div className="priority-options">
          <label className={billingMode === "PARTNER_PAYS" ? "priority-option option" : "priority-option"}>
            <input
              type="radio"
              name="billingMode"
              checked={billingMode === "PARTNER_PAYS"}
              onChange={() => setBillingMode("PARTNER_PAYS")}
            />
            <span className="option-text">
              <strong>The institute pays</strong>
              <span className="muted small">
                We invoice them. No charge is ever raised against these students — they owe
                nothing, never appear on the debtors list, and are offered no payment button.
                Their fees page says the institute is paying.
              </span>
            </span>
          </label>
          <label className={billingMode === "STUDENT_PAYS" ? "priority-option option" : "priority-option"}>
            <input
              type="radio"
              name="billingMode"
              checked={billingMode === "STUDENT_PAYS"}
              onChange={() => setBillingMode("STUDENT_PAYS")}
            />
            <span className="option-text">
              <strong>The students pay us directly</strong>
              <span className="muted small">
                Exactly as our own students do — charges, instalments and receipts all behave
                normally. The institute sees nothing financial whatsoever.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="form-row">
        <Field label="City">
          <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Who we deal with there">
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            maxLength={200}
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Their email address">
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            maxLength={320}
          />
        </Field>
        <Field label="Their telephone">
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            maxLength={20}
          />
        </Field>
      </div>

      <div className="form-actions">
        <button
          className="btn btn-primary"
          disabled={busy || name.trim().length < 2 || code.trim().length < 2}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : "Add the institute"}
        </button>
      </div>
    </section>
  );
}

/* ========================================================================== *
 *  GIVING SOMEBODY AN ACCOUNT
 * ========================================================================== */

/**
 * THE ACCOUNT THAT LETS AN OUTSIDER IN.
 *
 * The password is shown ONCE and on this screen, not only mailed. Delivery is
 * never certain — the address may be wrong, the mail may be filtered — and an
 * account whose password went nowhere is one somebody has to reset before it
 * has ever been used. It is shown after creation rather than before, so it
 * cannot be read over a shoulder while the form is being filled in.
 */
function GiveAccount({ partner }: { partner: Partner }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NewAccount | null>(null);

  const submit = async () => {
    if (
      !window.confirm(
        `This creates a sign-in for ${fullName.trim() || "this person"} at ${partner.name}.\n\n` +
          `They will be able to read the records of every student imported against ` +
          `${partner.name} — names, released results, attendance and certificates.\n\n` +
          `Continue?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setCreated(
        await api.post<NewAccount>("/admin/users", {
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          role: "partner_admin",
          partnerInstituteId: partner.id,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That account could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="alert alert-ok">
        <strong>
          {created.fullName} can now sign in for {partner.name}
        </strong>
        {created.temporaryPassword && (
          <p>
            Temporary password: <code className="kbd">{created.temporaryPassword}</code> — they
            must change it when they first sign in.
          </p>
        )}
        {/*
          SAID PLAINLY WHEN THE MAIL DID NOT GO. The password is on screen
          either way, but somebody who believes it was emailed will not think
          to pass it on — and the account then sits unused until they chase it.
        */}
        {created.emailSent === false && (
          <p className="warn">
            The email could not be sent{created.emailDetail ? ` — ${created.emailDetail}` : ""}. Pass
            the password on yourself.
          </p>
        )}
        <p className="muted small">
          This is shown once. If it is lost, reset the account from the People screen rather than
          creating a second one.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="muted small">
        <span aria-hidden="true">
          <Icon name="shield" />
        </span>{" "}
        This person does not work here. They will be able to read the records of every student
        imported against {partner.name}, and nothing else in the System. Every record they open is
        logged against their name.
      </p>

      {error && <ErrorState message={error} />}

      <div className="form-row">
        <Field label="Their full name" required>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Their email address" required hint="This is what they sign in with.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Telephone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        </Field>
      </div>

      <div className="form-actions">
        <button
          className="btn btn-primary"
          disabled={busy || fullName.trim().length < 2 || !email.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Creating…" : "Create the account"}
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== *
 *  RAISING AN INVOICE
 * ========================================================================== */

interface BillingPreview {
  partner: { id: string; name: string };
  billable: Array<{
    studentId: string;
    name: string;
    registrationNo: string;
    programme: string | null;
    amount: number;
  }>;
  alreadyBilled: Array<{ name: string; registrationNo: string; onInvoice: string }>;
  unpriced: Array<{ name: string; registrationNo: string; why: string }>;
  total: number;
  currency: string;
}

/**
 * BILLING THE INSTITUTE FOR ITS STUDENTS.
 *
 * THE PREVIEW IS NOT OPTIONAL — the panel opens by fetching it, and the button
 * that raises the invoice does not exist until the names and the total are on
 * screen. This is a claim for real money against a real organisation and the
 * mistakes are invisible afterwards: an extra student, a missing one, or a
 * second invoice for a term already billed. Reading the list is the only
 * moment any of those can be caught.
 *
 * THE THREE GROUPS ARE SHOWN, not just the billable one. Students already on
 * an invoice are named with the invoice they are on, so somebody can check
 * rather than trust; students who cannot be priced are named with the reason,
 * because the alternative is an invoice quietly short by one student's fee.
 */
function RaiseInvoice({ partner, onDone }: { partner: Partner; onDone: () => void }) {
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [periodLabel, setPeriodLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /*
   * BILLING IS BEHIND RE-AUTHENTICATION, and so is merely LOOKING at what
   * would be billed — §4.5 puts every office action on `partner_invoice`
   * behind step-up, reads included. That is right: the preview lists every
   * partner student and what each is worth, which is commercial information
   * about another organisation.
   *
   * So the password is asked for once, when the panel opens, and the same
   * elevated token then carries the invoice itself. Asking twice for one
   * sitting would be theatre.
   */
  const [stepUp, setStepUp] = useState<null | (() => void)>(null);

  const loadPreview = useCallback(() => {
    setError(null);
    api
      .get<BillingPreview>(`/partners/${partner.id}/billing-preview`)
      .then(setPreview)
      .catch((e: unknown) => {
        if (needsStepUp(e)) {
          setStepUp(() => loadPreview);
          return;
        }
        setError(e instanceof ApiError ? e.message : "What is owed could not be worked out.");
      });
  }, [partner.id]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>(`/partners/${partner.id}/invoices`, {
        periodLabel: periodLabel.trim(),
        ...(dueDate ? { dueDate } : {}),
      });
      setDone(r.message);
      onDone();
    } catch (e) {
      if (needsStepUp(e)) {
        setStepUp(() => () => void submit());
      } else {
        setError(
          e instanceof ApiError
            ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
            : "That invoice could not be raised.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (stepUp) {
    return (
      <StepUpPrompt
        what={`bill ${partner.name}`}
        onCancel={() => setStepUp(null)}
        onDone={() => {
          const retry = stepUp;
          setStepUp(null);
          retry();
        }}
      />
    );
  }

  if (done) {
    return (
      <div className="alert alert-ok">
        <strong>{done}</strong>
        <p className="muted small">
          {partner.name} can see it in their portal now, with the students it covers.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      {error && <ErrorState message={error} />}
      {!preview && !error && <Skeleton lines={4} />}

      {preview && (
        <>
          {preview.billable.length === 0 ? (
            <EmptyState icon="money" title="Nobody to invoice">
              {preview.alreadyBilled.length > 0
                ? "Every one of their students is already on an invoice."
                : "No students have been imported against this institute yet."}
            </EmptyState>
          ) : (
            <>
              <p>
                <strong>
                  {preview.billable.length} student
                  {preview.billable.length === 1 ? "" : "s"}
                </strong>{" "}
                — {preview.currency} {preview.total.toLocaleString()} in total.
              </p>

              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Registration no.</th>
                      <th scope="col">Course</th>
                      <th scope="col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.billable.map((b) => (
                      <tr key={b.studentId}>
                        <td>{b.name}</td>
                        <td>{b.registrationNo}</td>
                        <td>{b.programme ?? <span className="muted">—</span>}</td>
                        <td>
                          {preview.currency} {b.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Named with the invoice they are on, so the exclusion can be
              checked rather than merely trusted. */}
          {preview.alreadyBilled.length > 0 && (
            <div className="alert">
              <p className="small">
                <strong>
                  {preview.alreadyBilled.length} already invoiced, and left off this one:
                </strong>{" "}
                {preview.alreadyBilled
                  .map((a) => `${a.name} (${a.onInvoice})`)
                  .join(", ")}
              </p>
            </div>
          )}

          {/* The ones that would make the invoice silently short. */}
          {preview.unpriced.length > 0 && (
            <div className="alert alert-warn">
              <p className="small">
                <strong>
                  {preview.unpriced.length} cannot be priced and will NOT be on this invoice:
                </strong>
              </p>
              <ul className="list">
                {preview.unpriced.map((u) => (
                  <li key={u.registrationNo} className="small">
                    {u.name} ({u.registrationNo}) — {u.why}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Publish the fee structure for their course, then raise a second invoice for them.
              </p>
            </div>
          )}

          {preview.billable.length > 0 && (
            <>
              <div className="form-row">
                <Field
                  label="What period is this for?"
                  required
                  hint="In your own words — “Spring 2026, Graphic Designing”. The partner checks this against their own records."
                >
                  <input
                    value={periodLabel}
                    onChange={(e) => setPeriodLabel(e.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field label="Due by">
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
              </div>

              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  disabled={busy || periodLabel.trim().length < 3}
                  onClick={() => void submit()}
                >
                  {busy
                    ? "Raising…"
                    : `Raise the invoice — ${preview.currency} ${preview.total.toLocaleString()}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
