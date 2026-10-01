import Link from "next/link";
import { notFound } from "next/navigation";
import { uploadDocument, retryDocument } from "@/app/document-actions";
import { Message } from "@/components/form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params; const query = await searchParams; const db = await createSupabaseServerClient();
  const { data: project } = await db.from("projects").select("id,name").eq("id", id).single(); if (!project) notFound();
  const { data: documents } = await db.from("source_documents").select("*").eq("project_id", id).order("created_at", { ascending: false });
  const ids = (documents ?? []).map((document) => document.id);
  const { data: runs } = ids.length ? await db.from("extraction_runs").select("*").in("source_document_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const runIds = (runs ?? []).map((run) => run.id);
  const { data: drafts } = runIds.length ? await db.from("extracted_drafts").select("*").in("extraction_run_id", runIds) : { data: [] };
  const draftByRun = new Map((drafts ?? []).map((draft) => [draft.extraction_run_id, draft]));
  const runByDocument = new Map((runs ?? []).map((run) => [run.source_document_id, run]));
  for (const run of runs ?? []) if (!runByDocument.has(run.source_document_id)) runByDocument.set(run.source_document_id, run);
  return <section><Message error={query.error} /><Link className="back" href={`/projects/${id}`}>← {project.name}</Link><h1>Document import</h1><p className="lead">Upload immutable XLS, XLSX, or text-based PDF evidence. Every result stays a draft until you confirm it.</p><form action={uploadDocument} className="upload-form"><input type="hidden" name="project_id" value={id} /><label><span>Document role</span><select name="kind" defaultValue="specification"><option value="specification">Specification</option><option value="supplier_quote">Supplier quote</option></select></label><label><span>File</span><input required name="file" type="file" accept=".xls,.xlsx,.pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf" /></label><button>Upload and extract</button></form><div className="data-list">{(documents ?? []).map((document) => { const run = runByDocument.get(document.id); const draft = run ? draftByRun.get(run.id) : undefined; return <article key={document.id}><div><strong>{document.original_filename}</strong><small>{document.kind} · {document.byte_size} bytes · SHA-256 {document.sha256.slice(0, 12)}…</small><small>Latest run: {run?.status ?? "not started"}</small></div><div className="actions">{draft && <Link className="button secondary" href={`/projects/${id}/documents/${draft.id}`}>{draft.review_status === "confirmed" ? "View confirmation" : "Review draft"}</Link>}{run?.status === "failed" && <form action={retryDocument} className="inline-form"><input type="hidden" name="project_id" value={id} /><input type="hidden" name="document_id" value={document.id} /><button className="secondary">Retry</button></form>}</div></article>; })}</div></section>;
}
