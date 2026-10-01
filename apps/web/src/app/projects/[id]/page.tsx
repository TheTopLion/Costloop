import Link from "next/link";
import { notFound } from "next/navigation";
import { repository } from "@/lib/repository";
import * as actions from "@/app/actions";
import { PasteReview } from "@/components/paste-review";
import { Message } from "@/components/form";
import { ComparisonWorkspace } from "@/components/comparison-workspace";
const t = (r: Record<string, unknown>, k: string) => String(r[k] ?? "");

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const { id } = await params,
    repo = repository();
  if (!repo) return <h1>Supabase is not configured</h1>;
  const p = await repo.projectWorkspace(id);
  if (!p) notFound();
  const names = new Map(p.suppliers.map((s) => [t(s, "id"), t(s, "name")]));
  return (
    <section>
      <Message error={query.error} />
      <Link className="back" href="/projects">
        ← Projects
      </Link>
      <h1>{p.name}</h1>
      <p className="muted">
        {p.client_name || "No client"} · {p.currency}
      </p>
      <div className="metrics">
        <article>
          <strong>{p.specItems.length}</strong>
          <span>Specification items</span>
        </article>
        <article>
          <strong>{p.quotes.length}</strong>
          <span>Supplier quotes</span>
        </article>
        <article>
          <strong>{p.awards.length}</strong>
          <span>Awards</span>
        </article>
      </div>
      <nav className="workflow-nav">
        <Link href={`/projects/${id}/workspace`}>Workspace</Link>
        <a href="#spec">1 Specification</a>
        <Link href={`/projects/${id}/documents`}>Import documents</Link>
        <a href="#suppliers">2 Suppliers</a>
        <a href="#quotes">3 Quotes</a>
        <a href="#compare">4 Compare</a>
        <a href="#proposal">5 Proposal</a>
      </nav>
      <section id="spec" className="workspace-section">
        <p className="eyebrow">Step 1</p>
        <h2>Specification</h2>
        <div className="split">
          <form action={actions.saveSpecItem}>
            <input type="hidden" name="project_id" value={id} />
            <h3>Add line</h3>
            <input name="position" placeholder="Position" />
            <input required name="description" placeholder="Description" />
            <input name="quantity" placeholder="Quantity" />
            <input name="unit" placeholder="Unit" />
            <button>Add</button>
          </form>
          <div className="panel">
            <h3>Paste from Excel</h3>
            <PasteReview projectId={id} />
          </div>
        </div>
        <div className="data-list">
          {p.specItems.map((x) => (
            <article key={t(x, "id")}>
              <div>
                <strong>
                  {t(x, "position")} {t(x, "description")}
                </strong>
                <small>
                  {t(x, "quantity")} {t(x, "unit")}
                </small>
              </div>
              <details>
                <summary>Edit</summary>
                <form action={actions.saveSpecItem} className="compact-form">
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="id" value={t(x, "id")} />
                  <input name="position" defaultValue={t(x, "position")} />
                  <input
                    name="description"
                    defaultValue={t(x, "description")}
                  />
                  <input name="quantity" defaultValue={t(x, "quantity")} />
                  <input name="unit" defaultValue={t(x, "unit")} />
                  <button>Save</button>
                </form>
              </details>
              <form action={actions.deleteSpecItem} className="inline-form">
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="id" value={t(x, "id")} />
                <button className="danger">Delete</button>
              </form>
            </article>
          ))}
        </div>
      </section>
      <section id="suppliers" className="workspace-section">
        <p className="eyebrow">Step 2</p>
        <h2>Suppliers</h2>
        <form action={actions.saveSupplier} className="compact-form">
          <input type="hidden" name="project_id" value={id} />
          <input required name="name" placeholder="Name" />
          <input type="email" name="email" placeholder="Email" />
          <input name="phone" placeholder="Phone" />
          <input name="tax_id" placeholder="Tax ID" />
          <button>Add</button>
        </form>
        <div className="data-list">
          {p.suppliers.map((x) => (
            <article key={t(x, "id")}>
              <div>
                <strong>{t(x, "name")}</strong>
                <small>{t(x, "email") || "No email"}</small>
              </div>
              <details>
                <summary>Edit</summary>
                <form action={actions.saveSupplier} className="compact-form">
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="id" value={t(x, "id")} />
                  <input name="name" defaultValue={t(x, "name")} />
                  <input name="email" defaultValue={t(x, "email")} />
                  <input name="phone" defaultValue={t(x, "phone")} />
                  <input name="tax_id" defaultValue={t(x, "tax_id")} />
                  <button>Save</button>
                </form>
              </details>
              <form action={actions.deleteSupplier} className="inline-form">
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="id" value={t(x, "id")} />
                <button className="danger">Delete</button>
              </form>
            </article>
          ))}
        </div>
      </section>
      <section id="quotes" className="workspace-section">
        <p className="eyebrow">Step 3</p>
        <h2>Quotes</h2>
        <form action={actions.createQuote} className="compact-form">
          <input type="hidden" name="project_id" value={id} />
          <select required name="supplier_id" defaultValue="">
            <option value="" disabled>
              Supplier
            </option>
            {p.suppliers.map((x) => (
              <option key={t(x, "id")} value={t(x, "id")}>
                {t(x, "name")}
              </option>
            ))}
          </select>
          <input name="quote_number" placeholder="Quote #" />
          <input type="date" name="quote_date" />
          <select name="currency" defaultValue={p.currency}>
            {["KZT", "USD", "EUR", "RUB"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button>Create</button>
        </form>
        {p.quotes.map((q) => (
          <article className="quote-card" key={t(q, "id")}>
            <h3>
              {names.get(t(q, "supplier_id"))} ·{" "}
              {t(q, "quote_number") || "Unnumbered"} ({t(q, "currency")})
            </h3>
            <p className="muted">Status: {t(q, "status")}</p>
            {p.quoteLines
              .filter((l) => l.quote_id === q.id)
              .map((l) => (
                <div className="quote-line" key={t(l, "id")}>
                  <span>
                    {t(l, "position")} {t(l, "raw_description")}
                  </span>
                  <strong>
                    {t(l, "raw_quantity")} {t(l, "raw_unit")} ×{" "}
                    {t(l, "raw_unit_price")} = {t(l, "raw_total")}{" "}
                    {t(l, "raw_currency")}
                  </strong>
                </div>
              ))}
            <form action={actions.addQuoteLine} className="compact-form">
              <input type="hidden" name="project_id" value={id} />
              <input type="hidden" name="quote_id" value={t(q, "id")} />
              <input name="position" placeholder="Position" />
              <input
                required
                name="raw_description"
                placeholder="Description"
              />
              <input name="raw_quantity" placeholder="Qty" />
              <input name="raw_unit" placeholder="Unit" />
              <input name="raw_unit_price" placeholder="Unit price" />
              <input
                type="hidden"
                name="raw_currency"
                value={t(q, "currency")}
              />
              <button>Add line</button>
            </form>
            {t(q, "status") === "pending" && p.quoteLines.some((line) => line.quote_id === q.id) && (
              <form action={actions.confirmQuote} className="inline-form">
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="quote_id" value={t(q, "id")} />
                <button className="secondary">Confirm quote for comparison</button>
              </form>
            )}
          </article>
        ))}
      </section>
      <ComparisonWorkspace
        projectId={id}
        currency={p.currency}
        specItems={p.specItems}
        suppliers={p.suppliers}
        snapshots={p.snapshots}
        cells={p.cells}
        awards={p.awards}
        exchangeRates={p.exchangeRates}
        quoteLines={p.quoteLines}
        lineMatches={p.lineMatches}
      />
      <section id="proposal" className="workspace-section">
        <p className="eyebrow">Step 5</p>
        <h2>Proposal versions</h2>
        <p className="muted">
          Create a permanent commercial snapshot from the currently awarded
          lines.
        </p>
        <form action={actions.createProposalVersion} className="compact-form">
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="currency" value={p.currency} />
          <label>
            <span>Proposal number</span>
            <input
              required
              name="proposal_number"
              placeholder="e.g. APP-2026-001"
            />
          </label>
          <label>
            <span>Markup percent</span>
            <input
              name="markup_percent"
              defaultValue="10"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Tax percent</span>
            <input name="tax_percent" defaultValue="12" inputMode="decimal" />
          </label>
          <label>
            <span>Validity (days)</span>
            <input name="validity_days" defaultValue="30" inputMode="numeric" />
          </label>
          <label>
            <span>Client notes</span>
            <textarea name="notes" placeholder="Delivery, inclusions, or clarifications" />
          </label>
          <label>
            <span>Commercial terms</span>
            <textarea name="commercial_terms" placeholder="Payment and delivery terms" />
          </label>
          <button disabled={!p.awards.length}>Create proposal version</button>
        </form>
        <div className="data-list">
          {p.proposalVersions.map((v) => {
            const proposal = p.proposals.find((x) => x.id === v.proposal_id);
            return (
              <article key={t(v, "id")}>
                <div>
                  <strong>
                    {t(proposal ?? {}, "proposal_number")} · v{t(v, "version")}
                  </strong>
                  <small>
                    Subtotal {t(v, "subtotal")} + markup {t(v, "markup_amount")}{" "}
                    + tax {t(v, "tax_amount")}
                  </small>
                </div>
                <strong>
                  {t(v, "grand_total")} {t(proposal ?? {}, "currency")}
                </strong>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
