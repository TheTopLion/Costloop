import "server-only";

import { randomUUID } from "node:crypto";
import { normalizeUnit } from "@/domain/normalization";
import { exportLatestProposal } from "@/lib/proposal-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PendingConfirmation = { id: string; toolName: string; summary: string };
export type ToolMutationResult = Record<string, unknown> & { pendingConfirmation?: PendingConfirmation };

const affirmative = /^(?:да|давай|подтверждаю|согласен|согласна|yes|y|confirm|confirmed|ок|okay|выполняй|удаляй)[.!\s]*$/iu;

function cleanDecimal(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  return String(value).replace(",", ".");
}

function positionParts(value: string) {
  return value.split(".").map((part) => Number(part));
}

function comparePositions(a: string, b: string) {
  const left = positionParts(a), right = positionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? -1) - (right[i] ?? -1);
    if (difference) return difference;
  }
  return a.localeCompare(b, "ru");
}

export class ProjectOperations {
  constructor(
    readonly projectId: string,
    private readonly selectedIds: string[] = [],
    private readonly currentMessage = "",
    private readonly pendingConfirmationId?: string,
  ) {}

  private async db() { return createSupabaseServerClient(); }

  private async project() {
    const db = await this.db();
    const { data, error } = await db.from("projects").select("id,company_id,name,client_name,currency").eq("id", this.projectId).single();
    if (error || !data) throw new Error(error?.message ?? "Project not found");
    return data;
  }

  async read(positions?: string[]) {
    const db = await this.db();
    let query = db.from("spec_items")
      .select("id,section_id,position,description,quantity,unit,estimated_unit_price,estimated_currency,estimated_line_total,input_status,revision,sort_order")
      .eq("project_id", this.projectId).order("sort_order");
    if (positions?.length) query = query.in("position", positions);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async resolveIds(scope: "selected" | "all" | "positions", positions: string[] = []) {
    if (scope === "selected") {
      if (!this.selectedIds.length) throw new Error("Сначала выберите строки в таблице справа.");
      const db = await this.db();
      const { data, error } = await db.from("spec_items").select("id").eq("project_id", this.projectId).in("id", this.selectedIds);
      if (error) throw new Error(error.message);
      if ((data ?? []).length !== this.selectedIds.length) throw new Error("Одна или несколько выбранных строк находятся вне текущего проекта.");
      return this.selectedIds;
    }
    const rows = await this.read(scope === "positions" ? positions : undefined);
    if (!rows.length) throw new Error("Подходящие строки не найдены.");
    return rows.map((row) => String(row.id));
  }

  private async audit(entityType: string, entityId: string) {
    const db = await this.db();
    const { data } = await db.from("audit_events").select("id,action,entity_type,entity_id,occurred_at")
      .eq("entity_type", entityType).eq("entity_id", entityId).order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    return data ?? undefined;
  }

  private async confirmation(toolName: string, args: Record<string, unknown>, summary: string, confirmationId?: string) {
    const db = await this.db();
    const id = confirmationId ?? this.pendingConfirmationId;
    if (!id) {
      const project = await this.project();
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Sign in required");
      const { data, error } = await db.from("assistant_confirmations").insert({
        company_id: project.company_id,
        project_id: this.projectId,
        actor_id: user.id,
        tool_name: toolName,
        arguments: args,
        summary,
      }).select("id,tool_name,summary").single();
      if (error || !data) throw new Error(error?.message ?? "Could not request confirmation");
      return { pendingConfirmation: { id: data.id, toolName: data.tool_name, summary: data.summary } };
    }
    if (!affirmative.test(this.currentMessage.trim())) throw new Error("Для выполнения ответьте явным «да» на запрос подтверждения.");
    const { data, error } = await db.from("assistant_confirmations").select("id,tool_name,arguments,summary,expires_at,consumed_at")
      .eq("id", id).eq("project_id", this.projectId).eq("tool_name", toolName).single();
    if (error || !data) throw new Error("Подтверждение не найдено или относится к другой операции.");
    if (data.consumed_at) throw new Error("Это подтверждение уже использовано.");
    if (new Date(data.expires_at).getTime() < Date.now()) throw new Error("Подтверждение истекло. Повторите команду.");
    return { confirmationId: data.id as string, arguments: data.arguments as Record<string, unknown> };
  }

  private async consumeConfirmation(id: string) {
    const db = await this.db();
    const { error } = await db.from("assistant_confirmations").update({ consumed_at: new Date().toISOString() }).eq("id", id).is("consumed_at", null);
    if (error) throw new Error(error.message);
  }

  async createProject(input: { name: string; client: string; currency?: string; confirmationId?: string }): Promise<ToolMutationResult> {
    const proposed = { name: input.name.trim(), client: input.client.trim(), currency: input.currency };
    const approval = await this.confirmation("create_project", proposed,
      `Создать проект «${proposed.name}» для клиента «${proposed.client}»${proposed.currency ? ` (${proposed.currency})` : ""}?`, input.confirmationId);
    if ("pendingConfirmation" in approval) return approval;
    const args = approval.arguments;
    const current = await this.project();
    const db = await this.db();
    const { data: { user } } = await db.auth.getUser();
    if (!user) throw new Error("Sign in required");
    const { data, error } = await db.from("projects").insert({
      company_id: current.company_id,
      created_by: user.id,
      name: String(args.name),
      client_name: String(args.client),
      currency: String(args.currency ?? current.currency),
    }).select("id,name,client_name,currency").single();
    if (error || !data) throw new Error(error?.message ?? "Project was not created");
    await this.consumeConfirmation(approval.confirmationId);
    return { project: data, audit: await this.audit("projects", data.id), summary: `Проект «${data.name}» создан.` };
  }

  private async resolveSection(position: string, explicit?: string) {
    const db = await this.db();
    const inferred = position.includes(".") ? position.split(".")[0] : "";
    const requested = explicit?.trim() || inferred;
    if (!requested) return null;
    const { data: sections, error } = await db.from("spec_sections").select("id,position,description")
      .eq("project_id", this.projectId).eq("position", requested);
    if (error) throw new Error(error.message);
    if ((sections ?? []).length === 1) return sections![0];
    if ((sections ?? []).length > 1) throw new Error(`Раздел ${requested} неоднозначен. Уточните название раздела.`);
    const prefix = `${requested}.`;
    const { data: siblings, error: siblingError } = await db.from("spec_items").select("section_id")
      .eq("project_id", this.projectId).like("position", `${prefix}%`).not("section_id", "is", null);
    if (siblingError) throw new Error(siblingError.message);
    const ids = [...new Set((siblings ?? []).map((row) => row.section_id).filter(Boolean))];
    if (ids.length === 1) {
      const { data: section } = await db.from("spec_sections").select("id,position,description").eq("id", ids[0]).eq("project_id", this.projectId).single();
      return section;
    }
    if (position.includes(".")) throw new Error(`Не удалось однозначно определить родительский раздел для позиции ${position}. Уточните sectionPosition.`);
    return null;
  }

  async addSpecLine(input: {
    position: string; description: string; quantity?: string | number | null; unit?: string | null;
    estimatedUnitPrice?: string | number | null; sectionPosition?: string;
  }) {
    const project = await this.project();
    const db = await this.db();
    const position = input.position.trim();
    const section = await this.resolveSection(position, input.sectionPosition);
    const existing = position ? await this.read([position]) : [];
    if (existing.length) throw new Error(`Позиция ${input.position} уже существует. Уточните номер новой строки.`);
    const all = await this.read();
    const siblings = section ? all.filter((row) => row.section_id === section.id) : [];
    const previous = siblings.filter((row) => comparePositions(String(row.position ?? ""), position) < 0)
      .sort((a, b) => comparePositions(String(a.position ?? ""), String(b.position ?? ""))).at(-1);
    const next = siblings.filter((row) => comparePositions(String(row.position ?? ""), position) > 0)
      .sort((a, b) => comparePositions(String(a.position ?? ""), String(b.position ?? "")))[0];
    const sortOrder = previous ? Number(previous.sort_order) + 1
      : next ? Number(next.sort_order)
        : siblings.length ? Math.max(...siblings.map((row) => Number(row.sort_order))) + 1
          : all.length ? Math.max(...all.map((row) => Number(row.sort_order))) + 1 : 0;
    if (all.some((row) => Number(row.sort_order) >= sortOrder)) {
      const affected = [...all].filter((row) => Number(row.sort_order) >= sortOrder).sort((a, b) => Number(b.sort_order) - Number(a.sort_order));
      for (const row of affected) {
        const { error } = await db.from("spec_items").update({ sort_order: Number(row.sort_order) + 1 }).eq("id", row.id).eq("project_id", this.projectId);
        if (error) throw new Error(error.message);
      }
    }
    const quantity = cleanDecimal(input.quantity);
    const unit = input.unit?.trim() || null;
    const { data, error } = await db.from("spec_items").insert({
      company_id: project.company_id,
      project_id: this.projectId,
      section_id: section?.id ?? null,
      position: position || null,
      description: input.description.trim(),
      quantity,
      unit,
      normalized_quantity: quantity,
      normalized_unit: normalizeUnit(unit ?? ""),
      estimated_unit_price: cleanDecimal(input.estimatedUnitPrice),
      estimated_currency: input.estimatedUnitPrice == null ? null : project.currency,
      sort_order: sortOrder,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message ?? "Specification line was not created");
    return {
      item: data,
      section: section ? { id: section.id, position: section.position, description: section.description } : null,
      audit: await this.audit("spec_items", data.id),
      summary: `Строка ${data.position} добавлена${section ? ` в раздел ${section.position} «${section.description}»` : ""}. Статус ввода: ${data.input_status}.`,
    };
  }

  private async findItem(itemId?: string, position?: string) {
    const db = await this.db();
    let query = db.from("spec_items").select("*").eq("project_id", this.projectId);
    query = itemId ? query.eq("id", itemId) : query.eq("position", position ?? "");
    const { data, error } = await query.limit(2);
    if (error) throw new Error(error.message);
    if ((data ?? []).length !== 1) throw new Error((data ?? []).length ? "Найдено несколько строк. Уточните строку." : "Строка не найдена в текущем проекте.");
    return data![0];
  }

  async editSpecLine(input: {
    itemId?: string; position?: string; newPosition?: string; description?: string;
    quantity?: string | number | null; unit?: string | null; estimatedUnitPrice?: string | number | null;
  }) {
    const existing = await this.findItem(input.itemId, input.position);
    const patch: Record<string, unknown> = {};
    if (input.newPosition !== undefined) patch.position = input.newPosition.trim();
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.quantity !== undefined) { patch.quantity = cleanDecimal(input.quantity); patch.normalized_quantity = cleanDecimal(input.quantity); }
    if (input.unit !== undefined) { patch.unit = input.unit?.trim() || null; patch.normalized_unit = normalizeUnit(input.unit ?? ""); }
    if (input.estimatedUnitPrice !== undefined) {
      patch.estimated_unit_price = cleanDecimal(input.estimatedUnitPrice);
      patch.estimated_currency = input.estimatedUnitPrice == null || input.estimatedUnitPrice === "" ? null : (await this.project()).currency;
    }
    if (!Object.keys(patch).length) throw new Error("Укажите описание, единицу или количество, которое нужно изменить.");
    const db = await this.db();
    const { data, error } = await db.from("spec_items").update(patch).eq("id", existing.id).eq("project_id", this.projectId).select("*").single();
    if (error || !data) throw new Error(error?.message ?? "Specification line was not updated");
    return { item: data, audit: await this.audit("spec_items", data.id), summary: `Строка ${data.position} обновлена. Статус ввода: ${data.input_status}.` };
  }

  async deleteSpecLine(input: { itemId?: string; position?: string; confirmationId?: string }): Promise<ToolMutationResult> {
    const item = await this.findItem(input.itemId, input.position);
    const proposed = { itemId: item.id, position: item.position, description: item.description };
    const approval = await this.confirmation("delete_spec_line", proposed,
      `Удалить строку ${item.position} «${item.description}»? Это удалит одну строку спецификации.`, input.confirmationId);
    if ("pendingConfirmation" in approval) return approval;
    const args = approval.arguments;
    const deleted = await this.deleteSpecLineDirect(String(args.itemId));
    await this.consumeConfirmation(approval.confirmationId);
    return { ...deleted, summary: `Строка ${args.position} удалена.` };
  }

  async deleteSpecLineDirect(itemId: string) {
    const item = await this.findItem(itemId);
    const db = await this.db();
    const { error } = await db.from("spec_items").delete().eq("id", item.id).eq("project_id", this.projectId);
    if (error) throw new Error(error.message);
    return { deletedId: item.id, audit: await this.audit("spec_items", item.id), summary: `Строка ${item.position} удалена.` };
  }

  async runComparison(input: { confirmationId?: string }): Promise<ToolMutationResult> {
    const db = await this.db();
    const { count } = await db.from("supplier_quotes").select("id", { count: "exact", head: true }).eq("project_id", this.projectId).eq("status", "confirmed");
    const proposed = { confirmedQuotes: count ?? 0 };
    const approval = await this.confirmation("run_comparison", proposed,
      `Создать новую неизменяемую версию сравнения по ${count ?? 0} подтверждённым предложениям поставщиков?`, input.confirmationId);
    if ("pendingConfirmation" in approval) return approval;
    const { data, error } = await db.rpc("publish_manual_comparison", { target_project: this.projectId });
    if (error) throw new Error(error.message);
    await this.consumeConfirmation(approval.confirmationId);
    const snapshotId = typeof data === "string" ? data : String(data ?? "");
    const { data: snapshot } = await db.from("comparison_snapshots").select("id,version,base_currency,created_at").eq("id", snapshotId).maybeSingle();
    return { snapshot, summary: `Сравнение выполнено backend-сервисом. Создана версия ${snapshot?.version ?? "—"}.` };
  }

  async applyMarkup(input: { scope: "selected" | "all" | "positions"; positions?: string[]; percentage: number; confirmationId?: string }): Promise<ToolMutationResult> {
    const itemIds = await this.resolveIds(input.scope, input.positions);
    const proposed = { itemIds, percentage: input.percentage };
    const approval = await this.confirmation("apply_markup", proposed,
      `Применить наценку ${input.percentage}% к ${itemIds.length} строкам? Backend детерминированно изменит цену каждой указанной строки.`, input.confirmationId);
    if ("pendingConfirmation" in approval) return approval;
    const args = approval.arguments;
    const db = await this.db();
    const { data, error } = await db.rpc("apply_estimate_percentage", {
      target_project: this.projectId,
      target_items: args.itemIds as string[],
      percentage: args.percentage as number,
      operation_id: randomUUID(),
    });
    if (error) throw new Error(error.message);
    await this.consumeConfirmation(approval.confirmationId);
    return data as ToolMutationResult;
  }

  async exportProposal(input: { confirmationId?: string } = {}): Promise<ToolMutationResult> {
    const approval = await this.confirmation("export_proposal", {},
      "Сформировать новый XLSX-файл из всех строк последней сохранённой версии коммерческого предложения?", input.confirmationId);
    if ("pendingConfirmation" in approval) return approval;
    const exported = await exportLatestProposal(this.projectId);
    await this.consumeConfirmation(approval.confirmationId);
    return { ...exported, summary: `XLSX для ${exported.proposalNumber}, версия ${exported.version}, сформирован из сохранённого proposal snapshot.` };
  }

  async executePendingConfirmation(confirmationId: string): Promise<ToolMutationResult> {
    const db = await this.db();
    const { data, error } = await db.from("assistant_confirmations").select("tool_name,arguments")
      .eq("id", confirmationId).eq("project_id", this.projectId).single();
    if (error || !data) throw new Error("Подтверждение не найдено.");
    const args = data.arguments as Record<string, unknown>;
    if (data.tool_name === "create_project") return this.createProject({
      name: String(args.name), client: String(args.client), currency: args.currency ? String(args.currency) : undefined, confirmationId,
    });
    if (data.tool_name === "delete_spec_line") return this.deleteSpecLine({ itemId: String(args.itemId), confirmationId });
    if (data.tool_name === "run_comparison") return this.runComparison({ confirmationId });
    if (data.tool_name === "export_proposal") return this.exportProposal({ confirmationId });
    if (data.tool_name === "apply_markup") {
      const approval = await this.confirmation("apply_markup", {}, "", confirmationId);
      if ("pendingConfirmation" in approval) return approval;
      const confirmed = approval.arguments;
      const { data: receipt, error: rpcError } = await db.rpc("apply_estimate_percentage", {
        target_project: this.projectId,
        target_items: confirmed.itemIds as string[],
        percentage: confirmed.percentage as number,
        operation_id: randomUUID(),
      });
      if (rpcError) throw new Error(rpcError.message);
      await this.consumeConfirmation(approval.confirmationId);
      return receipt as ToolMutationResult;
    }
    throw new Error("Неподдерживаемый тип подтверждения.");
  }

  async executeLatestPendingConfirmation(): Promise<ToolMutationResult> {
    const db = await this.db();
    const { data, error } = await db.from("assistant_confirmations").select("id")
      .eq("project_id", this.projectId).is("consumed_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) throw new Error("Нет ожидающей подтверждения операции.");
    return this.executePendingConfirmation(data.id);
  }
}
