"use client";
import { useState } from "react";
import { importSpecRows } from "@/app/actions";
export function PasteReview({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState(""); const parsed = rows.split(/\r?\n/).filter(Boolean).map(line => line.split("\t"));
  return <div className="stack"><textarea aria-label="Paste spreadsheet rows" placeholder="Position[TAB]Description[TAB]Quantity[TAB]Unit" value={rows} onChange={e => setRows(e.target.value)}/>{parsed.length > 0 && <div className="review"><strong>Review {parsed.length} row(s)</strong>{parsed.slice(0,6).map((row,i) => <div key={i}>{row[0] || "—"} · {row[1] || "description missing"} · {row[2] || "—"} {row[3] || ""}</div>)}</div>}<form action={importSpecRows}><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="rows" value={rows}/><button disabled={!parsed.length}>Confirm import</button></form></div>;
}
