import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateProposalWorkbook } from "@/lib/proposal-workbook";

type JsonLine = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

/**
 * Exports only persisted proposal-version values. This service deliberately does
 * no price, markup, tax, or total arithmetic.
 */
export async function exportLatestProposal(projectId: string) {
  const db = await createSupabaseServerClient();
  const { data: project, error: projectError } = await db.from("projects")
    .select("id,company_id,name,client_name,currency")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Project not found");

  const { data: proposal, error: proposalError } = await db.from("proposals")
    .select("id,proposal_number,currency")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (proposalError) throw new Error(proposalError.message);
  if (!proposal) throw new Error("Сначала создайте версию коммерческого предложения из подтверждённых победителей.");

  const { data: version, error: versionError } = await db.from("proposal_versions")
    .select("id,version,subtotal,markup_amount,tax_amount,grand_total,calculation_snapshot,generator_version,created_at,export_document_id")
    .eq("proposal_id", proposal.id)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (versionError || !version) throw new Error(versionError?.message ?? "Proposal version not found");

  const snapshot = (version.calculation_snapshot ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines as JsonLine[] : [];
  const filename = `proposal-${proposal.proposal_number}-v${version.version}.xlsx`.replace(/[^a-zA-Z0-9._-]+/g, "-");

  if (version.export_document_id) {
    const { data: existing, error: existingError } = await db.from("source_documents")
      .select("id,storage_path,original_filename")
      .eq("id", version.export_document_id)
      .single();
    if (existingError || !existing) throw new Error(existingError?.message ?? "Recorded proposal export is missing");
    const { data: signed, error: signedError } = await db.storage.from("generated-exports").createSignedUrl(existing.storage_path, 600);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message ?? "Could not create download link");
    return {
      documentId: existing.id,
      filename: existing.original_filename,
      downloadUrl: signed.signedUrl,
      proposalNumber: proposal.proposal_number,
      version: version.version,
      grandTotal: text(version.grand_total),
      currency: proposal.currency,
    };
  }

  const { data: company, error: companyError } = await db.from("companies")
    .select("name,legal_name")
    .eq("id", project.company_id)
    .single();
  if (companyError || !company) throw new Error(companyError?.message ?? "Company not found");
  const bytes = await generateProposalWorkbook({
    seller_name: company.name,
    seller_legal_name: company.legal_name ?? "",
    client_name: project.client_name ?? "",
    project_name: project.name,
    proposal_number: proposal.proposal_number,
    version: version.version,
    currency: proposal.currency,
    created_at: version.created_at,
    validity_days: snapshot.validity_days ?? null,
    notes: text(snapshot.notes),
    commercial_terms: text(snapshot.commercial_terms),
    subtotal: text(snapshot.client_subtotal),
    markup_amount: "",
    tax_amount: text(version.tax_amount),
    grand_total: text(version.grand_total),
    lines: lines.map((line) => ({
      position: text(line.position),
      description: text(line.description),
      quantity: text(line.quantity),
      unit: text(line.unit),
      unit_price: text(line.client_unit_price),
      line_total: text(line.client_line_total),
    })),
  });
  const exportId = randomUUID();
  const storagePath = `${project.company_id}/${projectId}/${exportId}/${filename}`;
  const { error: uploadError } = await db.storage.from("generated-exports").upload(storagePath, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { error: documentError } = await db.from("source_documents").insert({
    id: exportId,
    company_id: project.company_id,
    project_id: projectId,
    kind: "proposal",
    bucket_id: "generated-exports",
    storage_path: storagePath,
    original_filename: filename,
    media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byte_size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (documentError) {
    await db.storage.from("generated-exports").remove([storagePath]);
    throw new Error(documentError.message);
  }
  const { error: linkError } = await db.from("proposal_versions")
    .update({ export_document_id: exportId, generator_version: "xlsxwriter-proposal-v1" })
    .eq("id", version.id)
    .is("export_document_id", null);
  if (linkError) throw new Error(linkError.message);
  const { data: signed, error: signedError } = await db.storage.from("generated-exports").createSignedUrl(storagePath, 600);
  if (signedError || !signed?.signedUrl) throw new Error(signedError?.message ?? "Could not create download link");
  return {
    documentId: exportId,
    filename,
    downloadUrl: signed.signedUrl,
    proposalNumber: proposal.proposal_number,
    version: version.version,
    grandTotal: text(version.grand_total),
    currency: proposal.currency,
  };
}
