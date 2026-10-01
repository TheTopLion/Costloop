"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractDocument } from "@/lib/extraction-worker";

async function documentActor(projectId: string) {
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth?error=Sign+in+to+import+documents");
  const { data: project } = await db.from("projects").select("id,company_id").eq("id", projectId).single();
  if (!project) throw new Error("Project unavailable");
  const { data: membership } = await db.from("company_memberships").select("role").eq("company_id", project.company_id).eq("user_id", user.id).single();
  if (!membership || !["owner", "admin", "estimator"].includes(membership.role)) throw new Error("An estimator role is required to import documents");
  return { db, user, project };
}

async function processDocument(projectId: string, documentId: string) {
  const { db, user, project } = await documentActor(projectId);
  const { data: document, error: documentError } = await db.from("source_documents").select("*").eq("id", documentId).eq("project_id", projectId).single();
  if (documentError || !document) throw new Error("Source document unavailable");
  const runId = randomUUID();
  const jobId = randomUUID();
  const provider = process.env.APPRAISE_MODEL_PROVIDER ?? "fake";
  const { error: runError } = await db.from("extraction_runs").insert({
    id: runId, company_id: project.company_id, source_document_id: documentId,
    provider, model: provider === "fake" ? "deterministic-table" : (process.env.APPRAISE_MODEL ?? "configured-sonnet"),
    prompt_version: "v1", schema_version: "v1", parser_version: "v1",
    status: "running", started_at: new Date().toISOString(), created_by: user.id,
  });
  if (runError) throw new Error(runError.message);
  try {
    const { error: jobError } = await db.from("background_jobs").insert({ id: jobId, company_id: project.company_id, project_id: projectId,
      job_type: "extraction", idempotency_key: runId, status: "running", attempts: 1, max_attempts: 3,
      payload: { source_document_id: documentId, extraction_run_id: runId }, created_by: user.id });
    if (jobError) throw new Error(jobError.message);
    const { data: file, error: downloadError } = await db.storage.from(document.bucket_id).download(document.storage_path);
    if (downloadError || !file) throw new Error("Source file could not be downloaded. Retry when storage is available.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== document.sha256) throw new Error("Source document integrity check failed");
    const result = await extractDocument(document.original_filename, bytes, document.kind);
    const draftId = randomUUID();
    const { error: draftError } = await db.from("extracted_drafts").insert({ id: draftId, company_id: project.company_id,
      extraction_run_id: runId, payload: result.payload, validation_warnings: result.warnings ?? [] });
    if (draftError) throw new Error(draftError.message);
    const { error: completeError } = await db.from("extraction_runs").update({ status: "succeeded", completed_at: new Date().toISOString(),
      attempt_count: 1, raw_response: result, parser_version: String(result.parser_version ?? "v1"), model: String(result.model ?? "deterministic-table"),
      prompt_version: String(result.prompt_version ?? "v1"), schema_version: String(result.schema_version ?? "v1") }).eq("id", runId);
    if (completeError) throw new Error(completeError.message);
    await db.from("background_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), result: { draft_id: draftId } }).eq("id", jobId);
    return draftId;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Extraction failed";
    await db.from("extraction_runs").update({ status: "failed", completed_at: new Date().toISOString(), error: { message } }).eq("id", runId);
    await db.from("background_jobs").update({ status: "failed", last_error: { message } }).eq("id", jobId);
    throw new Error(message);
  }
}

export async function uploadDocument(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id"));
  let draftId: string;
  try {
    const kind = z.enum(["specification", "supplier_quote"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw new Error("Select an XLSX or PDF file up to 10 MB");
    const extension = file.name.split(".").pop()?.toLowerCase();
    const mime = extension === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : extension === "xls" ? "application/vnd.ms-excel" : extension === "pdf" ? "application/pdf" : null;
    if (!mime || (file.type && file.type !== mime && file.type !== "application/octet-stream")) throw new Error("File extension and media type must identify an XLS, XLSX, or PDF document");
    const bytes = Buffer.from(await file.arrayBuffer());
    const validSignature = extension === "pdf"
      ? bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      : extension === "xls"
        ? bytes.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))
        : bytes.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));
    if (!validSignature) throw new Error("The file signature does not match its extension");
    const { db, user, project } = await documentActor(projectId);
    const documentId = randomUUID();
    const storagePath = `${project.company_id}/${projectId}/${documentId}.${extension}`;
    const { error: storageError } = await db.storage.from("source-documents").upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (storageError) throw new Error(storageError.message);
    const { error: documentError } = await db.from("source_documents").insert({ id: documentId, company_id: project.company_id, project_id: projectId,
      kind, bucket_id: "source-documents", storage_path: storagePath, original_filename: file.name,
      media_type: mime, byte_size: file.size, sha256: createHash("sha256").update(bytes).digest("hex"), uploaded_by: user.id });
    if (documentError) throw new Error(documentError.message);
    draftId = await processDocument(projectId, documentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    redirect(`/projects/${projectId}/documents?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/projects/${projectId}/documents`);
  redirect(`/projects/${projectId}/documents/${draftId}`);
}

export async function retryDocument(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id"));
  const documentId = z.string().uuid().parse(form.get("document_id"));
  let draftId: string;
  try { draftId = await processDocument(projectId, documentId); }
  catch (error) { redirect(`/projects/${projectId}/documents?error=${encodeURIComponent(error instanceof Error ? error.message : "Retry failed")}`); }
  redirect(`/projects/${projectId}/documents/${draftId}`);
}

export async function confirmDraft(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id"));
  const draftId = z.string().uuid().parse(form.get("draft_id"));
  try {
    const { db } = await documentActor(projectId);
    if (form.get("acknowledge") !== "yes") throw new Error("Review the source evidence and acknowledge all warnings first");
    const rows = JSON.parse(z.string().max(2_000_000).parse(form.get("reviewed_lines")));
    const sections = JSON.parse(z.string().max(500_000).parse(form.get("reviewed_sections")));
    const { error } = await db.rpc("confirm_extraction_draft", { target_draft: draftId, target_project: projectId,
      reviewed_sections: sections, reviewed_lines: rows, target_supplier: form.get("supplier_id") || null });
    if (error) throw new Error(error.message);
  } catch (error) { redirect(`/projects/${projectId}/documents/${draftId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Confirmation failed")}`); }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}
