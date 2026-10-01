import {
  createComparison,
  generateMatchReview,
  reviewMatch,
  saveExchangeRate,
  selectAward,
  selectWholeQuote,
} from "@/app/actions";

type Row = Record<string, unknown>;
const value = (row: Row | undefined, ...keys: string[]) => {
  for (const key of keys)
    if (row?.[key] !== null && row?.[key] !== undefined && row[key] !== "")
      return String(row[key]);
  return "—";
};
const object = (input: unknown): Row =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Row)
    : {};
const messages = (input: unknown) =>
  Array.isArray(input)
    ? input.map((item) =>
        typeof item === "string"
          ? item
          : value(object(item), "message", "label", "code", "warning"),
      )
    : input
      ? [String(input)]
      : [];
const percent = (input: unknown) => {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? `${Math.round(parsed * 100)}%` : "—";
};
const warningDetails = (input: unknown) =>
  Array.isArray(input)
    ? input.map((item) => {
        const warning = object(item);
        if (warning.code === "spread_from_cheapest")
          return `${value(warning, "percent")}% above the lowest comparable offer`;
        return value(warning, "message", "label", "code", "warning");
      })
    : messages(input);
const provenance = (input: unknown) => {
  const source = object(input);
  const location = [
    source.sheet ? `sheet ${source.sheet}` : null,
    source.page ? `page ${source.page}` : null,
    source.cell_range ?? source.cells ?? source.row_range ?? null,
  ].filter(Boolean);
  return location.length ? location.join(" · ") : "Manual entry or source location unavailable";
};

export function ComparisonWorkspace({
  projectId,
  currency,
  specItems,
  suppliers,
  snapshots,
  cells,
  awards,
  exchangeRates,
  quoteLines,
  lineMatches,
}: {
  projectId: string;
  currency: string;
  specItems: Row[];
  suppliers: Row[];
  snapshots: Row[];
  cells: Row[];
  awards: Row[];
  exchangeRates: Row[];
  quoteLines: Row[];
  lineMatches: Row[];
}) {
  const snapshot = snapshots[0];
  const snapshotId = value(snapshot, "id");
  const currentCells = snapshot
    ? cells.filter((cell) => value(cell, "snapshot_id") === snapshotId)
    : [];
  const currentAwards = awards.filter(
    (award) => value(award, "snapshot_id") === snapshotId,
  );
  const lineAwards = new Map(
    currentAwards
      .filter((a) => value(a, "scope") !== "quote")
      .map((a) => [value(a, "spec_item_id"), a]),
  );
  const wholeAward = currentAwards.find((a) => value(a, "scope") === "quote");
  const quoteCurrencies = [
    ...new Set(
      currentCells
        .map((c) => value(c, "raw_currency"))
        .filter((c) => c !== "—" && c !== currency),
    ),
  ];
  return (
    <section id="compare" className="workspace-section">
      <div className="title-row">
        <div>
          <p className="eyebrow">Step 4</p>
          <h2>Comparison workspace</h2>
          <p className="muted">
            Raw offers remain unchanged. Quantity normalization and FX
            conversion are shown separately before the evaluated amount.
          </p>
        </div>
        <form action={createComparison} className="inline-form">
          <input type="hidden" name="project_id" value={projectId} />
          <button>
            {snapshot ? "Publish new snapshot" : "Create comparison"}
          </button>
        </form>
      </div>
      <div className="panel">
        <div className="title-row">
          <div>
            <h3>Bid matching review</h3>
            <p className="muted">Suggestions preserve score and technical-conflict evidence. Only high-confidence compatible matches are confirmed automatically.</p>
          </div>
          <form action={generateMatchReview} className="inline-form">
            <input type="hidden" name="project_id" value={projectId} />
            <button disabled={!specItems.length || !quoteLines.length}>Generate suggestions</button>
          </form>
        </div>
        {lineMatches.filter((match) => value(match, "review_status") === "pending").map((match) => {
          const spec = specItems.find((item) => value(item, "id") === value(match, "spec_item_id"));
          const quote = quoteLines.find((item) => value(item, "id") === value(match, "quote_line_id"));
          const scores = object(match.component_scores);
          return <article className="quote-line" key={value(match, "id")}>
            <div><strong>{value(spec, "position")} {value(spec, "description")}</strong><small>{quote ? `${value(quote, "position")} ${value(quote, "raw_description")}` : "No compatible candidate"} · {Math.round(Number(scores.lexical ?? 0) * 100)}% lexical · {value(match, "relation")}</small></div>
            <form action={reviewMatch} className="compact-form">
              <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="spec_item_id" value={value(match, "spec_item_id")} />
              <select name="quote_line_id" defaultValue={value(match, "quote_line_id") === "—" ? "" : value(match, "quote_line_id")}><option value="">Unmatched</option>{quoteLines.map((line) => <option key={value(line, "id")} value={value(line, "id")}>{value(line, "position")} {value(line, "raw_description")}</option>)}</select>
              <select name="relation" defaultValue={value(match, "relation")}>{["MATCH", "NO_MATCH", "PARTIAL", "SUPERSET", "SPLIT", "MERGED"].map((relation) => <option key={relation}>{relation}</option>)}</select>
              <input name="reason" placeholder="Review reason" /><button className="secondary">Confirm decision</button>
            </form>
          </article>;
        })}
        {!lineMatches.length && <p className="muted">Generate suggestions after confirming supplier quotes. You can choose another candidate, mark unmatched, or record partial/split/merged scope.</p>}
      </div>
      <div className="split">
        <form action={saveExchangeRate}>
          <h3>Add exchange rate</h3>
          <input type="hidden" name="project_id" value={projectId} />
          <label>
            <span>From currency</span>
            <select
              name="from_currency"
              required
              defaultValue={quoteCurrencies[0] ?? ""}
            >
              <option value="" disabled>
                Select currency
              </option>
              {[...new Set([...quoteCurrencies, "USD", "EUR", "RUB"])]
                .filter((c) => c !== currency)
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
          </label>
          <label>
            <span>Rate to {currency}</span>
            <input
              name="rate"
              required
              inputMode="decimal"
              placeholder={`1 unit = … ${currency}`}
            />
          </label>
          <label>
            <span>Source</span>
            <input
              name="source"
              required
              placeholder="e.g. National Bank, 2026-09-17"
            />
          </label>
          <button>Save rate</button>
        </form>
        <div className="panel">
          <h3>Current project rates</h3>
          {exchangeRates.length ? (
            <div className="data-list">
              {exchangeRates.map((rate) => (
                <div key={value(rate, "id")}>
                  <strong>
                    1 {value(rate, "from_currency")} = {value(rate, "rate")}{" "}
                    {value(rate, "to_currency")}
                  </strong>
                  <small>
                    {value(rate, "source")} · effective{" "}
                    {value(rate, "effective_on")} · v{value(rate, "version")}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              No rates saved. Add one for each foreign quote currency, then
              publish a new comparison snapshot.
            </p>
          )}
        </div>
      </div>
      {!snapshot ? (
        <div className="empty">
          <h3>No comparison snapshot yet</h3>
          <p>
            Enter supplier quotes and any required exchange rates, then create
            the comparison.
          </p>
        </div>
      ) : (
        <>
          <div className="snapshot-heading">
            <div>
              <strong>Snapshot v{value(snapshot, "version")}</strong>
              <small>
                Base {value(snapshot, "base_currency")} · normalization{" "}
                {value(snapshot, "normalization_version")} · matching{" "}
                {value(snapshot, "matching_version")}
              </small>
            </div>
            <span className="badge">Immutable published view</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Specification</th>
                  {suppliers.map((s) => (
                    <th key={value(s, "id")}>{value(s, "name")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {specItems.map((spec) => (
                  <tr key={value(spec, "id")}>
                    <th>
                      {value(spec, "position")} {value(spec, "description")}
                      <small>
                        {value(spec, "quantity")} {value(spec, "unit")}
                      </small>
                      {value(spec, "input_status") === "needs_input" && <small className="badge missing">Needs input: quantity or unit is missing</small>}
                    </th>
                    {suppliers.map((s) => {
                      const cell = currentCells.find(
                          (c) =>
                            value(c, "spec_item_id") === value(spec, "id") &&
                            value(c, "supplier_id") === value(s, "id"),
                        ),
                        award = lineAwards.get(value(spec, "id"));
                      if (!cell || value(cell, "state") === "missing_bid")
                        return (
                          <td key={value(s, "id")}>
                            <span className="badge missing">
                              {value(cell, "state_reason") === "pending price"
                                ? "Pending price"
                                : "Missing bid"}
                            </span>
                            <small>
                              {value(cell, "state_reason") === "pending price"
                                ? "Matched row has no price yet"
                                : "No matched supplier line"}
                            </small>
                          </td>
                        );
                      const qty = object(cell.quantity_conversion),
                        fx = object(cell.currency_conversion),
                        warnings = warningDetails(cell.warnings),
                        cheapest =
                          warnings.some((w) => /cheapest|lowest/i.test(w)) ||
                          cell.cheapest === true ||
                          cell.is_cheapest === true;
                      const selected =
                        value(award, "supplier_id") === value(s, "id") ||
                        value(wholeAward, "supplier_id") === value(s, "id");
                      const quoteLine = quoteLines.find(
                        (line) => value(line, "id") === value(cell, "quote_line_id"),
                      );
                      const confirmedMatch = lineMatches.find(
                        (match) =>
                          value(match, "review_status") === "confirmed" &&
                          value(match, "spec_item_id") === value(spec, "id") &&
                          value(match, "quote_line_id") === value(cell, "quote_line_id"),
                      );
                      return (
                        <td
                          key={value(s, "id")}
                          className={selected ? "winner" : ""}
                        >
                          <div className="comparison-layer">
                            <small>Raw supplier value</small>
                            <strong>
                              {value(cell, "raw_amount")}{" "}
                              {value(cell, "raw_currency")}
                            </strong>
                            <span className="trace-detail">
                              {value(quoteLine, "raw_quantity")} {value(quoteLine, "raw_unit")} × {value(quoteLine, "raw_unit_price")}
                            </span>
                          </div>
                          <div className="comparison-layer">
                            <small>Match confidence &amp; provenance</small>
                            {confirmedMatch ? (
                              <span>
                                {percent(confirmedMatch.confidence)} · {value(confirmedMatch, "relation")} · {value(confirmedMatch, "method")}
                              </span>
                            ) : (
                              <span>Legacy exact resolver · no reviewed mapping</span>
                            )}
                            <span className="trace-detail">{provenance(quoteLine?.source_provenance)}</span>
                          </div>
                          <div className="comparison-layer">
                            <small>Quantity normalization</small>
                            <span>
                              {Object.keys(qty).length
                                ? `${value(qty, "raw_quantity", "from_quantity", "input_quantity")} ${value(qty, "raw_unit", "from_unit", "input_unit")} → ${value(qty, "normalized_quantity", "to_quantity", "output_quantity")} ${value(qty, "normalized_unit", "to_unit", "output_unit")}`
                                : "No conversion"}
                            </span>
                          </div>
                          <div className="comparison-layer">
                            <small>FX conversion</small>
                            <span>
                              {Object.keys(fx).length
                                ? `${value(fx, "from_currency", "source_currency")} × ${value(fx, "rate", "exchange_rate")} → ${value(fx, "to_currency", "target_currency")}`
                                : value(cell, "raw_currency") === currency
                                  ? "Same currency"
                                  : "Not available"}
                            </span>
                          </div>
                          <div className="comparison-layer evaluated">
                            <small>Evaluated value</small>
                            <strong>
                              {value(
                                cell,
                                "evaluated_amount",
                                "normalized_amount",
                              )}{" "}
                              {value(cell, "normalized_currency")}
                            </strong>
                            {cheapest && (
                              <span className="badge cheapest">
                                Cheapest comparable
                              </span>
                            )}
                          </div>
                          {cell.comparable ? (
                            <form action={selectAward} className="inline-form">
                              {[
                                ["project_id", projectId],
                                ["snapshot_id", snapshotId],
                                ["spec_item_id", value(spec, "id")],
                                ["supplier_id", value(s, "id")],
                                ["quote_line_id", value(cell, "quote_line_id")],
                                ["rationale", "Manual line award"],
                              ].map(([name, v]) => (
                                <input
                                  key={name}
                                  type="hidden"
                                  name={name}
                                  value={v}
                                />
                              ))}
                              <button className="small-button">
                                {selected ? "Selected winner" : "Select winner"}
                              </button>
                            </form>
                          ) : (
                            <span className="badge excluded">
                              Non-comparable
                            </span>
                          )}
                          {warnings.length > 0 && (
                            <ul className="warnings">
                              {warnings.map((warning, index) => (
                                <li key={`${warning}-${index}`}>{warning}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            {suppliers.map((s) => {
              const supplierCells = currentCells.filter(
                  (c) => value(c, "supplier_id") === value(s, "id"),
                ),
                valid =
                  specItems.length > 0 &&
                  supplierCells.length === specItems.length &&
                  supplierCells.every(
                    (c) => c.comparable && value(c, "quote_line_id") !== "—",
                  );
              return (
                <form
                  action={selectWholeQuote}
                  key={value(s, "id")}
                  className="inline-form"
                >
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="snapshot_id" value={snapshotId} />
                  <input
                    type="hidden"
                    name="supplier_id"
                    value={value(s, "id")}
                  />
                  <button className="secondary" disabled={!valid}>
                    {value(wholeAward, "supplier_id") === value(s, "id")
                      ? "Whole quote selected"
                      : `Select all from ${value(s, "name")}`}
                  </button>
                  {!valid && <small>Not all lines are comparable</small>}
                </form>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
