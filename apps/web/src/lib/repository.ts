import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProjectSummary = {
  id: string;
  name: string;
  client_name: string | null;
  currency: string;
  status: string;
  updated_at: string;
};

export type Workspace = { companyId: string; companyName: string; role: string };

export interface AppraiseRepository {
  workspace(): Promise<Workspace | null>;
  projects(): Promise<ProjectSummary[]>;
  project(id: string): Promise<ProjectSummary | null>;
  projectWorkspace(id: string): Promise<ProjectWorkspace | null>;
}

export type ProjectWorkspace = ProjectSummary & {
  specItems: Record<string, unknown>[];
  suppliers: Record<string, unknown>[];
  quotes: Record<string, unknown>[];
  quoteLines: Record<string, unknown>[];
  lineMatches: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  cells: Record<string, unknown>[];
  awards: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  proposalVersions: Record<string, unknown>[];
  exchangeRates: Record<string, unknown>[];
};

class SupabaseRepository implements AppraiseRepository {
  async workspace() {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.from("company_memberships").select("company_id, role, companies(name)").limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const company = data.companies as unknown as { name: string } | null;
    return { companyId: data.company_id, companyName: company?.name ?? "Workspace", role: data.role };
  }

  async projects() {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.from("projects").select("id,name,client_name,currency,status,updated_at").order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ProjectSummary[];
  }

  async project(id: string) {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.from("projects").select("id,name,client_name,currency,status,updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as ProjectSummary | null;
  }


  async projectWorkspace(id: string) {
    const project = await this.project(id);
    if (!project) return null;
    const db = await createSupabaseServerClient();
    const [spec, suppliers, quotes, snapshots, awards, proposals, exchangeRates] = await Promise.all([
      db.from("spec_items").select("*").eq("project_id", id).order("sort_order"),
      db.from("suppliers").select("*").order("name"),
      db.from("supplier_quotes").select("*,suppliers(name)").eq("project_id", id).order("created_at"),
      db.from("comparison_snapshots").select("*").eq("project_id", id).order("version", { ascending: false }),
      db.from("award_decisions").select("*").eq("project_id", id).order("decided_at", { ascending: false }),
      db.from("proposals").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      db.from("exchange_rates").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    ]);
    for (const result of [spec, suppliers, quotes, snapshots, awards, proposals, exchangeRates]) if (result.error) throw result.error;
    const quoteIds = (quotes.data ?? []).map((q) => q.id);
    const snapshotIds = (snapshots.data ?? []).map((s) => s.id);
    const proposalIds = (proposals.data ?? []).map((p) => p.id);
    const [lines, cells, versions, matches] = await Promise.all([
      quoteIds.length ? db.from("quote_lines").select("*").in("quote_id", quoteIds).order("sort_order") : Promise.resolve({ data: [], error: null }),
      snapshotIds.length ? db.from("comparison_cells").select("*").in("snapshot_id", snapshotIds) : Promise.resolve({ data: [], error: null }),
      proposalIds.length ? db.from("proposal_versions").select("*").in("proposal_id", proposalIds).order("version", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      db.from("line_matches").select("*").eq("project_id", id).in("review_status", ["pending", "confirmed"]).order("created_at", { ascending: false }),
    ]);
    for (const result of [lines, cells, versions, matches]) if (result.error) throw result.error;
    return { ...project, specItems: spec.data ?? [], suppliers: suppliers.data ?? [], quotes: quotes.data ?? [], quoteLines: lines.data ?? [], lineMatches: matches.data ?? [], snapshots: snapshots.data ?? [], cells: cells.data ?? [], awards: awards.data ?? [], proposals: proposals.data ?? [], proposalVersions: versions.data ?? [], exchangeRates: exchangeRates.data ?? [] } as ProjectWorkspace;
  }
}

export function repository(): AppraiseRepository | null {
  return isSupabaseConfigured() ? new SupabaseRepository() : null;
}
