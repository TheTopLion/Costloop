import Link from "next/link";
import { notFound } from "next/navigation";
import { ExtractionReview } from "@/components/extraction-review";
import { Message } from "@/components/form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ExtractionDraftPage({ params, searchParams }: { params: Promise<{ id: string; draftId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id, draftId } = await params; const query = await searchParams; const db = await createSupabaseServerClient();
  const { data: draft } = await db.from("extracted_drafts").select("*").eq("id", draftId).single(); if (!draft) notFound();
  const { data: run } = await db.from("extraction_runs").select("*").eq("id", draft.extraction_run_id).single();
  const { data: document } = run ? await db.from("source_documents").select("*").eq("id", run.source_document_id).eq("project_id", id).single() : { data: null };
  if (!run || !document) notFound();
  const { data: suppliers } = await db.from("suppliers").select("id,name").order("name");
  const payload = draft.payload && typeof draft.payload === "object" && !Array.isArray(draft.payload) ? draft.payload as Record<string, unknown> : {};
  const isQuote = document.kind === "supplier_quote";
  return <section><Message error={query.error} /><Link className="back" href={`/projects/${id}/documents`}>← Documents</Link><h1>Review extraction</h1><p className="muted">{document.original_filename} · {run.provider} / {run.model} · parser {run.parser_version}</p>{draft.review_status === "confirmed" ? <div className="panel"><h2>Confirmed</h2><p>This immutable draft has already created canonical records.</p></div> : <ExtractionReview projectId={id} draftId={draftId} payload={payload} suppliers={suppliers ?? []} isQuote={isQuote} />}</section>;
}
