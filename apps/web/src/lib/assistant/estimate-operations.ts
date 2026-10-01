import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EstimateReceipt = {
  operation_id: string;
  status: "committed" | "undone";
  summary: string;
  rows_affected?: number;
  before?: Record<string, unknown>[];
  after?: Record<string, unknown>[];
};

// COPY → ADAPT: mirrors Klaudia's OperationService boundary. The database RPC
// owns revision checks and the receipt; the agent never performs raw updates.
export class EstimateOperations {
  constructor(
    private readonly projectId: string,
    private readonly selectedIds: string[],
  ) {}

  private async db() {
    return createSupabaseServerClient();
  }

  async read(positions?: string[]) {
    const db = await this.db();
    let query = db.from("spec_items")
      .select("id,position,description,quantity,unit,estimated_unit_price,estimated_currency,estimated_line_total,input_status,revision,sort_order")
      .eq("project_id", this.projectId)
      .order("sort_order");
    if (positions?.length) query = query.in("position", positions);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async resolveIds(scope: "selected" | "all" | "positions", positions: string[] = []) {
    if (scope === "selected") {
      if (!this.selectedIds.length) throw new Error("Сначала выберите строки в таблице справа.");
      return this.selectedIds;
    }
    const rows = await this.read(scope === "positions" ? positions : undefined);
    if (!rows.length) throw new Error("Подходящие строки не найдены.");
    return rows.map((row) => String(row.id));
  }

  async changePricesByPercentage(input: {
    scope: "selected" | "all" | "positions";
    positions?: string[];
    percentage: number;
  }) {
    const db = await this.db();
    const itemIds = await this.resolveIds(input.scope, input.positions);
    const { data, error } = await db.rpc("apply_estimate_percentage", {
      target_project: this.projectId,
      target_items: itemIds,
      percentage: input.percentage,
      operation_id: randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as EstimateReceipt;
  }

  async undo(operationId?: string) {
    const db = await this.db();
    let id = operationId;
    if (!id) {
      const { data, error } = await db.from("estimate_operations")
        .select("id")
        .eq("project_id", this.projectId)
        .eq("status", "committed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      id = data?.id;
    }
    if (!id) throw new Error("Нет операции, которую можно отменить.");
    const { data, error } = await db.rpc("undo_estimate_operation", { operation_id: id });
    if (error) throw new Error(error.message);
    return data as EstimateReceipt & { rows: Record<string, unknown>[] };
  }
}

