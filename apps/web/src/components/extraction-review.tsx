"use client";

import { useMemo, useState } from "react";
import { confirmDraft } from "@/app/document-actions";

type Row = Record<string, unknown>;
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const objects = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === "object") : [];

function Evidence({ source }: { source: unknown }) {
  const item = source && typeof source === "object" ? source as Row : {};
  return <aside className="evidence"><strong>Source evidence</strong><small>{text(item.sheet) || `Page ${text(item.page)}`} · row {text(item.row)} · {text(item.cell_range)}</small><p>{text(item.evidence_text)}</p></aside>;
}

export function ExtractionReview({ projectId, draftId, payload, suppliers, isQuote }: { projectId: string; draftId: string; payload: Row; suppliers: Row[]; isQuote: boolean }) {
  const [sections, setSections] = useState<Row[]>(() => objects(payload.sections));
  const [lines, setLines] = useState<Row[]>(() => objects(payload.lines));
  const warnings = useMemo(() => Array.isArray(payload.warnings) ? payload.warnings.map(text) : [], [payload.warnings]);
  const updateLine = (index: number, key: string, value: string) => setLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value } : line));
  const updateSection = (index: number, key: string, value: string) => setSections((current) => current.map((section, i) => i === index ? { ...section, [key]: value } : section));
  return <form action={confirmDraft} className="review-form">
    <input type="hidden" name="project_id" value={projectId} />
    <input type="hidden" name="draft_id" value={draftId} />
    <input type="hidden" name="reviewed_sections" value={JSON.stringify(sections)} />
    <input type="hidden" name="reviewed_lines" value={JSON.stringify(lines)} />
    {warnings.length > 0 && <div className="message error"><strong>Review required</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    {isQuote && <label><span>Supplier</span><select required name="supplier_id" defaultValue=""><option value="" disabled>Select the supplier for this quotation</option>{suppliers.map((supplier) => <option key={text(supplier.id)} value={text(supplier.id)}>{text(supplier.name)}</option>)}</select></label>}
    {sections.length > 0 && <section><h2>Sections</h2><p className="muted">These headings organize the specification. They are not priceable line items.</p>{sections.map((section, index) => <div className="review-row" key={`${text(section.position)}-${index}`}><div className="review-fields"><input aria-label="Section position" value={text(section.position)} onChange={(event) => updateSection(index, "position", event.target.value)} placeholder="Section" /><input aria-label="Section description" value={text(section.description)} onChange={(event) => updateSection(index, "description", event.target.value)} /><small>Parent: {text(section.parent_position) || "Top level"}</small></div><Evidence source={section.source} /></div>)}</section>}
    <section><h2>Extracted line items</h2><p className="muted">Correct the fields against the source. Blank prices are marked pending price; they are never changed to zero.</p>{lines.map((line, index) => <div className="review-row" key={`${text(line.position)}-${index}`}><div className="review-fields"><input aria-label="Position" value={text(line.position)} onChange={(event) => updateLine(index, "position", event.target.value)} placeholder="Position" /><input aria-label="Description" value={text(line.description)} onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Description" /><div className="review-grid"><input aria-label="Quantity" value={text(line.quantity)} onChange={(event) => updateLine(index, "quantity", event.target.value)} placeholder="Quantity" /><input aria-label="Unit" value={text(line.unit)} onChange={(event) => updateLine(index, "unit", event.target.value)} placeholder="Unit" /></div>{isQuote && <div className="review-grid"><input aria-label="Unit price" value={text(line.unit_price)} onChange={(event) => updateLine(index, "unit_price", event.target.value)} placeholder="Unit price" /><input aria-label="Line total" value={text(line.line_total)} onChange={(event) => updateLine(index, "line_total", event.target.value)} placeholder="Line total" /><input aria-label="Currency" value={text(line.currency)} onChange={(event) => updateLine(index, "currency", event.target.value.toUpperCase())} placeholder="Currency" maxLength={3} /></div>}<small>{text(line.section_position) ? `Section ${text(line.section_position)} · ` : ""}{text(line.price_status) === "pending_price" ? "Pending price" : ""}{text(line.quantity_status) === "pending_quantity" ? "Pending quantity" : ""}</small></div><Evidence source={line.source} /></div>)}</section>
    <label className="acknowledgement"><input required type="checkbox" name="acknowledge" value="yes" /> I reviewed the source evidence and warnings.</label>
    <button>Confirm and create canonical records</button>
  </form>;
}
