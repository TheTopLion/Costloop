"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { quoteLineTotal } from "@/domain/costing";
import { decimal } from "@/domain/decimal";
import { normalizeUnit } from "@/domain/normalization";
import { generateMatches } from "@/lib/matching-worker";

const authSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function signIn(form: FormData) {
  const values = authSchema.safeParse(Object.fromEntries(form));
  if (!values.success) redirect("/auth?error=Enter+a+valid+email+and+an+8-character+password");
  const db = await createSupabaseServerClient();
  const { error } = await db.auth.signInWithPassword(values.data);
  if (error) redirect(`/auth?error=${encodeURIComponent(error.message)}`);
  redirect("/projects");
}

export async function signUp(form: FormData) {
  const values = authSchema.safeParse(Object.fromEntries(form));
  if (!values.success) redirect("/auth?error=Enter+a+valid+email+and+an+8-character+password");
  const db = await createSupabaseServerClient();
  const { error } = await db.auth.signUp(values.data);
  if (error) redirect(`/auth?error=${encodeURIComponent(error.message)}`);
  redirect("/setup?notice=Check+your+email+if+confirmation+is+enabled");
}

export async function createCompany(form: FormData) {
  const name = z.string().trim().min(2).max(120).parse(form.get("name"));
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("create_company_workspace", { company_name: name });
  if (error) redirect(`/setup?error=${encodeURIComponent(error.message)}`);
  redirect("/projects");
}

export async function createProject(form: FormData) {
  const parsed = z.object({ name: z.string().trim().min(2).max(160), client_name: z.string().trim().max(160), currency: z.enum(["KZT", "USD", "EUR", "RUB"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/projects/new?error=Enter+a+valid+project+name+and+currency");
  const db = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) redirect("/auth?error=Sign+in+before+creating+a+project");
  const { data: membership, error: membershipError } = await db.from("company_memberships").select("company_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (membershipError || !membership) redirect(`/projects/new?error=${encodeURIComponent("Create a company workspace first")}`);
  const values = parsed.data;
  const { data, error } = await db.from("projects").insert({ ...values, client_name: values.client_name || null, company_id: membership.company_id, created_by: user.id }).select("id").single();
  if (error) redirect(`/projects/new?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/projects");
  redirect(`/projects/${data.id}/workspace`);
}

async function actor() {
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth?error=Sign+in+to+continue");
  const { data: membership } = await db.from("company_memberships").select("company_id").eq("user_id", user.id).limit(1).single();
  if (!membership) redirect("/setup?error=Create+a+workspace+first");
  return { db, user, companyId: membership.company_id };
}

const optionalDecimal = z.preprocess((v) => v === "" ? null : v, z.string().regex(/^\d+(\.\d+)?$/).nullable());
const itemSchema = z.object({ project_id: z.string().uuid(), id: z.string().uuid().optional(), position: z.string().trim().max(60), description: z.string().trim().min(2), quantity: optionalDecimal, unit: z.string().trim().max(30) });

export async function saveSpecItem(form: FormData) {
  const value = itemSchema.parse(Object.fromEntries(form));
  const { db, user, companyId } = await actor();
  const row = { project_id: value.project_id, company_id: companyId, position: value.position || null, description: value.description, quantity: value.quantity, unit: value.unit || null, normalized_quantity: value.quantity, normalized_unit: normalizeUnit(value.unit), created_by: user.id };
  const result = value.id ? await db.from("spec_items").update(row).eq("id", value.id) : await db.from("spec_items").insert(row);
  if (result.error) throw result.error;
  revalidatePath(`/projects/${value.project_id}`);
}

export async function deleteSpecItem(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id")); const id = z.string().uuid().parse(form.get("id"));
  const { db } = await actor(); const { error } = await db.from("spec_items").delete().eq("id", id); if (error) throw error;
  revalidatePath(`/projects/${projectId}`);
}

export async function importSpecRows(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id"));
  const raw = z.string().min(1).parse(form.get("rows")); const { db, user, companyId } = await actor();
  const rows = raw.split(/\r?\n/).filter(Boolean).map((line, index) => { const [position, description, quantity = "", unit = ""] = line.split("\t"); return { company_id: companyId, project_id: projectId, position: position?.trim() || null, description: description?.trim(), quantity: quantity.trim() || null, unit: unit.trim() || null, normalized_quantity: quantity.trim() || null, normalized_unit: normalizeUnit(unit), sort_order: index, created_by: user.id }; }).filter((r) => r.description);
  const { error } = await db.from("spec_items").insert(rows); if (error) throw error; revalidatePath(`/projects/${projectId}`);
}

export async function saveSupplier(form: FormData) {
  const value = z.object({ project_id: z.string().uuid(), id: z.string().uuid().optional(), name: z.string().trim().min(2), email: z.union([z.string().email(), z.literal("")]), phone: z.string(), tax_id: z.string() }).parse(Object.fromEntries(form));
  const { db, user, companyId } = await actor(); const row = { company_id: companyId, name: value.name, email: value.email || null, phone: value.phone || null, tax_id: value.tax_id || null, created_by: user.id };
  const result = value.id ? await db.from("suppliers").update(row).eq("id", value.id) : await db.from("suppliers").insert(row); if (result.error) throw result.error; revalidatePath(`/projects/${value.project_id}`);
}

export async function deleteSupplier(form: FormData) { const projectId = z.string().uuid().parse(form.get("project_id")); const { db } = await actor(); const { error } = await db.from("suppliers").delete().eq("id", z.string().uuid().parse(form.get("id"))); if (error) throw error; revalidatePath(`/projects/${projectId}`); }

export async function createQuote(form: FormData) {
  const value = z.object({ project_id: z.string().uuid(), supplier_id: z.string().uuid(), quote_number: z.string(), quote_date: z.string(), currency: z.string().regex(/^[A-Z]{3}$/) }).parse(Object.fromEntries(form));
  const { db, user, companyId } = await actor(); const { error } = await db.from("supplier_quotes").insert({ ...value, quote_number: value.quote_number || null, quote_date: value.quote_date || null, company_id: companyId, created_by: user.id }); if (error) throw error; revalidatePath(`/projects/${value.project_id}`);
}

export async function addQuoteLine(form: FormData) {
  const value = z.object({ project_id: z.string().uuid(), quote_id: z.string().uuid(), position: z.string(), raw_description: z.string().trim().min(2), raw_quantity: optionalDecimal, raw_unit: z.string(), raw_unit_price: optionalDecimal, raw_currency: z.string().regex(/^[A-Z]{3}$/) }).parse(Object.fromEntries(form));
  const { db, companyId } = await actor(); const total = value.raw_quantity && value.raw_unit_price ? quoteLineTotal({ quantity: decimal(value.raw_quantity), unitPrice: decimal(value.raw_unit_price), currency: value.raw_currency }) : null;
  const { project_id: projectId, ...line } = value;
  const { error } = await db.from("quote_lines").insert({ ...line, company_id: companyId, raw_total: total, normalized_description: value.raw_description.toLowerCase(), normalized_quantity: value.raw_quantity, normalized_unit: normalizeUnit(value.raw_unit), normalized_unit_price: value.raw_unit_price, normalized_total: total, normalized_currency: value.raw_currency }); if (error) throw error; revalidatePath(`/projects/${projectId}`);
}

export async function confirmQuote(form: FormData) {
  const value = z.object({ project_id: z.string().uuid(), quote_id: z.string().uuid() }).parse(Object.fromEntries(form));
  const { db } = await actor();
  const { error } = await db.from("supplier_quotes").update({ status: "confirmed" }).eq("id", value.quote_id).eq("project_id", value.project_id);
  if (error) redirect(`/projects/${value.project_id}?error=${encodeURIComponent(error.message)}#quotes`);
  revalidatePath(`/projects/${value.project_id}`);
}

export async function createComparison(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id"));
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("publish_manual_comparison", { target_project: projectId });
  if (error) redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}#compare`);
  revalidatePath(`/projects/${projectId}`);
}

export async function generateMatchReview(form: FormData) {
  const projectId = z.string().uuid().parse(form.get("project_id"));
  const { db } = await actor();
  const [specification, quotes] = await Promise.all([
    db.from("spec_items").select("id,position,description,unit").eq("project_id", projectId).order("sort_order"),
    db.from("quote_lines").select("id,position,raw_description,raw_unit,supplier_quotes!inner(project_id,status)").eq("supplier_quotes.project_id", projectId).eq("supplier_quotes.status", "confirmed").order("sort_order"),
  ]);
  if (specification.error || quotes.error) redirect(`/projects/${projectId}?error=${encodeURIComponent(specification.error?.message ?? quotes.error?.message ?? "Could not load matching inputs")}#compare`);
  let suggestions: unknown[];
  try {
    const result = await generateMatches(specification.data ?? [], quotes.data ?? []);
    suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  } catch (error) {
    redirect(`/projects/${projectId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Matching failed")}#compare`);
  }
  const { error } = await db.rpc("save_match_suggestions", { target_project: projectId, suggestions });
  if (error) redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}#compare`);
  revalidatePath(`/projects/${projectId}`);
}

export async function reviewMatch(form: FormData) {
  const value = z.object({ project_id: z.string().uuid(), spec_item_id: z.string().uuid(), quote_line_id: z.string().uuid().optional(), relation: z.enum(["MATCH", "NO_MATCH", "PARTIAL", "SUPERSET", "SPLIT", "MERGED"]), reason: z.string().max(500) }).parse(Object.fromEntries(form));
  const { db } = await actor();
  const { error } = await db.rpc("review_line_match", { target_project: value.project_id, target_spec: value.spec_item_id, target_quote_line: value.quote_line_id ?? null, target_relation: value.relation, target_reason: value.reason || null });
  if (error) redirect(`/projects/${value.project_id}?error=${encodeURIComponent(error.message)}#compare`);
  revalidatePath(`/projects/${value.project_id}`);
}

export async function saveExchangeRate(form: FormData) {
  const value = z.object({
    project_id: z.string().uuid(), from_currency: z.string().regex(/^[A-Z]{3}$/),
    rate: z.string().regex(/^\d+(\.\d+)?$/), source: z.string().trim().min(1).max(200),
  }).safeParse(Object.fromEntries(form));
  const projectId = z.string().uuid().parse(form.get("project_id"));
  if (!value.success) redirect(`/projects/${projectId}?error=Enter+a+positive+rate+and+source#compare`);
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("save_manual_rate", {
    target_project: projectId, source_currency: value.data.from_currency,
    conversion_rate: value.data.rate, rate_source: value.data.source,
  });
  if (error) redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}#compare`);
  revalidatePath(`/projects/${projectId}`);
}

async function award(form: FormData, whole: boolean) {
  const value = z.object({
    project_id: z.string().uuid(), snapshot_id: z.string().uuid(), supplier_id: z.string().uuid(),
  }).parse(Object.fromEntries(form));
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("set_manual_award", {
    target_project: value.project_id, target_snapshot: value.snapshot_id,
    target_supplier: value.supplier_id,
    target_spec: whole ? null : z.string().uuid().parse(form.get("spec_item_id")),
  });
  if (error) redirect(`/projects/${value.project_id}?error=${encodeURIComponent(error.message)}#compare`);
  revalidatePath(`/projects/${value.project_id}`);
}

export async function selectAward(form: FormData) { await award(form, false); }
export async function selectWholeQuote(form: FormData) { await award(form, true); }

export async function createProposalVersion(form: FormData) {
  const value = z.object({
    project_id: z.string().uuid(),
    proposal_number: z.string().trim().min(1).max(160),
    markup_percent: optionalDecimal,
    tax_percent: optionalDecimal,
    validity_days: z.coerce.number().int().min(0).max(3650),
    notes: z.string().max(8000),
    commercial_terms: z.string().max(8000),
  }).parse(Object.fromEntries(form));
  const { db } = await actor();
  const { error } = await db.rpc("create_awarded_proposal_v2", {
    target_project: value.project_id,
    proposal_reference: value.proposal_number,
    markup_percent: value.markup_percent ?? "0",
    tax_percent: value.tax_percent ?? "0",
    validity_days: value.validity_days,
    proposal_notes: value.notes,
    proposal_terms: value.commercial_terms,
  });
  if (error) {
    redirect(`/projects/${value.project_id}?error=${encodeURIComponent(error.message)}#proposal`);
  }
  revalidatePath(`/projects/${value.project_id}`);
}
