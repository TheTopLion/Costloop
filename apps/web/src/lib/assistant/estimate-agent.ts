import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { EstimateOperations, type EstimateReceipt } from "@/lib/assistant/estimate-operations";
import { parseLocalIntent } from "@/lib/assistant/intent";
import { ProjectOperations, type PendingConfirmation, type ToolMutationResult } from "@/lib/assistant/project-operations";
import { getAppraiseLanguageModel } from "@/lib/assistant/provider";

type ChatMessage = { role: "assistant" | "user"; content: string };
type AgentResponse = {
  message: string;
  rows: Record<string, unknown>[];
  receipt?: EstimateReceipt;
  action?: { label: string; href: string };
  confirmation?: PendingConfirmation;
  mode: "agent" | "local-tools";
};

function navigation(message: string, projectId: string) {
  const query = message.toLowerCase();
  if (query.includes("загруз") || query.includes("import") || query.includes("документ")) return { label: "Открыть импорт документов", href: `/projects/${projectId}/documents` };
  if (query.includes("сравн") || query.includes("поставщик") || query.includes("котиров")) return { label: "Открыть сравнение", href: `/projects/${projectId}#compare` };
  if (query.includes("кп") || query.includes("proposal") || query.includes("предложен")) return { label: "Открыть коммерческое предложение", href: `/projects/${projectId}#proposal` };
}

function money(value: unknown, currency: unknown) {
  return value == null ? "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value))} ${String(currency ?? "")}`.trim();
}

function summarize(result: ToolMutationResult) {
  return typeof result.summary === "string" ? result.summary : "Готово.";
}

async function runLocalTools(input: {
  message: string; projectId: string; selectedIds: string[]; pendingConfirmationId?: string;
}, operations: ProjectOperations): Promise<AgentResponse> {
  let result: ToolMutationResult | undefined;
  let action: AgentResponse["action"];
  let receipt: EstimateReceipt | undefined;
  if (input.pendingConfirmationId && /^(?:да|давай|подтверждаю|yes|confirm|ок|выполняй|удаляй)[.!\s]*$/iu.test(input.message.trim())) {
    result = await operations.executePendingConfirmation(input.pendingConfirmationId);
  } else {
    const createProject = input.message.match(/создай\s+(?:новый\s+)?проект(?:\s+(.+?))?\s+для\s+(.+)$/iu);
    const addLine = input.message.match(/добав(?:ь|ить)\s+(?:новую\s+)?строк(?:у|а)\s+([\d.]+)\s+(.+)$/iu);
    const deleteLine = input.message.match(/удал(?:и|ить)\s+(?:строк(?:у|а)|позици(?:ю|я))\s+([\d.]+)/iu);
    const editLine = input.message.match(/(?:измени|обнови|отредактируй)\s+(?:строк(?:у|а)|позици(?:ю|я))\s+([\d.]+)\s+(?:описание\s+)?(?:на\s+)?(.+)$/iu);
    const intent = parseLocalIntent(input.message);
    if (createProject) {
      const client = createProject[2].trim();
      result = await operations.createProject({ name: createProject[1]?.trim() || `Проект для ${client}`, client });
    } else if (addLine) {
      result = await operations.addSpecLine({ position: addLine[1], description: addLine[2] });
    } else if (deleteLine) {
      result = await operations.deleteSpecLine({ position: deleteLine[1] });
    } else if (editLine) {
      result = await operations.editSpecLine({ position: editLine[1], description: editLine[2] });
    } else if (/сравн|comparison/iu.test(input.message) && /запуст|выполн|созда|run/iu.test(input.message)) {
      result = await operations.runComparison({});
    } else if (/экспорт|xlsx|скача/iu.test(input.message)) {
      result = await operations.exportProposal();
      if (result.downloadUrl) action = { label: `Скачать ${String(result.filename)}`, href: String(result.downloadUrl) };
    } else if (intent.percentage != null) {
      result = await operations.applyMarkup({ scope: intent.scope, positions: intent.positions, percentage: intent.percentage });
      if (result.operation_id) receipt = result as unknown as EstimateReceipt;
    } else if (intent.undo) {
      const legacy = new EstimateOperations(input.projectId, input.selectedIds);
      const operationId = input.message.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
      receipt = await legacy.undo(operationId);
      result = receipt as unknown as ToolMutationResult;
    } else {
      const nav = navigation(input.message, input.projectId);
      if (nav) action = nav;
      const rows = await operations.read(intent.positions);
      const total = rows.reduce((sum, row) => sum + Number(row.estimated_line_total ?? 0), 0);
      const currency = rows[0]?.estimated_currency;
      const missing = rows.filter((row) => row.estimated_unit_price == null).length;
      return { message: nav ? "Переход подготовлен." : `В смете ${rows.length} строк. Итог: ${money(total, currency)}. Без цены: ${missing}.`, action, rows: await operations.read(), mode: "local-tools" };
    }
  }
  const confirmation = result?.pendingConfirmation;
  if (result?.operation_id) receipt = result as unknown as EstimateReceipt;
  return {
    message: confirmation ? `${confirmation.summary} Ответьте «да», чтобы выполнить.` : summarize(result ?? {}),
    receipt, action, confirmation, rows: await operations.read(), mode: "local-tools",
  };
}

export async function runEstimateAgent(input: {
  message: string;
  projectId: string;
  selectedIds: string[];
  selectionContext: string;
  pendingConfirmationId?: string;
  history: ChatMessage[];
}): Promise<AgentResponse> {
  const operations = new ProjectOperations(input.projectId, input.selectedIds, input.message, input.pendingConfirmationId);
  const model = getAppraiseLanguageModel();
  const explicitYes = /^(?:да|давай|подтверждаю|согласен|согласна|yes|y|confirm|confirmed|ок|okay|выполняй|удаляй)[.!\s]*$/iu.test(input.message.trim());
  if (explicitYes) {
    const confirmed = input.pendingConfirmationId
      ? await operations.executePendingConfirmation(input.pendingConfirmationId)
      : await operations.executeLatestPendingConfirmation();
    const confirmedReceipt = confirmed.operation_id ? confirmed as unknown as EstimateReceipt : undefined;
    const createdProject = confirmed.project as { id?: string } | undefined;
    const downloadUrl = typeof confirmed.downloadUrl === "string" ? confirmed.downloadUrl : undefined;
    return {
      message: summarize(confirmed),
      receipt: confirmedReceipt,
      action: createdProject?.id ? { label: "Открыть новый проект", href: `/projects/${createdProject.id}/workspace` }
        : downloadUrl ? { label: `Скачать ${String(confirmed.filename)}`, href: downloadUrl } : undefined,
      rows: await operations.read(),
      mode: model ? "agent" : "local-tools",
    };
  }
  if (!model) return runLocalTools(input, operations);

  let receipt: EstimateReceipt | undefined;
  let action: { label: string; href: string } | undefined;
  let confirmation: PendingConfirmation | undefined;
  const observe = <T extends ToolMutationResult>(result: T) => {
    if (result.pendingConfirmation) confirmation = result.pendingConfirmation;
    if (result.operation_id) receipt = result as unknown as EstimateReceipt;
    return result;
  };
  const isAffirmative = /^(?:да|давай|подтверждаю|согласен|согласна|yes|y|confirm|confirmed|ок|okay|выполняй|удаляй)[.!\s]*$/iu.test(input.message.trim());
  const withPending = (provided?: string) => provided ?? (isAffirmative ? input.pendingConfirmationId : undefined);
  const result = await generateText({
    model,
    stopWhen: stepCountIs(8),
    instructions: `Ты — помощник сметчика Appraise. Отвечай кратко по-русски. Appraise — единственный источник истины.
Всегда используй tools для чтения или изменения данных. Никогда не вычисляй и не выдумывай цены, наценку, сравнение или итог сам.
Для «выбранных строк» используй scope=selected: backend проверит текущий выбор UI.
Если tool вернул pendingConfirmation, дословно объясни, что изменится, и попроси пользователя ответить «да». Не вызывай tool повторно в этом ходе.
Если в контексте есть pending confirmation и текущий запрос — явное «да», вызови тот же tool с указанным confirmationId. Любой другой ответ не является подтверждением.
Для create_project сначала собери название проекта и клиента, затем вызови tool: сам tool всегда потребует подтверждение.
Для add_spec_line передай позицию отдельно. Не угадывай раздел: если backend сообщает неоднозначность, попроси sectionPosition.
run_comparison вызывает сохранённый Stage 04 RPC. apply_markup передаёт только процент и scope в детерминированный backend. export_proposal экспортирует только сохранённую proposal version.`,
    prompt: `Последние сообщения:\n${input.history.slice(-10).map((item) => `${item.role}: ${item.content}`).join("\n") || "(нет)"}
Текущий запрос: ${input.message}
Выбрано строк в UI: ${input.selectedIds.length}
Выделенный диапазон: ${input.selectionContext || "(нет)"}
Pending confirmation id: ${input.pendingConfirmationId ?? "(нет)"}`,
    tools: {
      read_estimate: tool({
        description: "Прочитать актуальные строки текущего проекта и сохранённые backend-итоги.",
        inputSchema: z.object({ positions: z.array(z.string()).optional() }),
        execute: async ({ positions }) => operations.read(positions),
      }),
      create_project: tool({
        description: "Запросить подтверждение и затем создать проект в текущей компании через tenant-scoped projects service.",
        inputSchema: z.object({ name: z.string().min(2), client: z.string().min(1), currency: z.enum(["KZT", "USD", "EUR", "RUB"]).optional(), confirmationId: z.string().uuid().optional() }),
        execute: async (args) => observe(await operations.createProject({ ...args, confirmationId: withPending(args.confirmationId) })),
      }),
      add_spec_line: tool({
        description: "Добавить одну строку в текущую спецификацию с section assignment, input_status и audit trigger.",
        inputSchema: z.object({
          position: z.string().min(1), description: z.string().min(2), quantity: z.union([z.string(), z.number()]).nullable().optional(),
          unit: z.string().nullable().optional(), estimatedUnitPrice: z.union([z.string(), z.number()]).nullable().optional(), sectionPosition: z.string().optional(),
        }),
        execute: async (args) => observe(await operations.addSpecLine(args)),
      }),
      edit_spec_line: tool({
        description: "Изменить описание, количество или единицу одной строки через тот же validated spec_items service, что и таблица.",
        inputSchema: z.object({ itemId: z.string().uuid().optional(), position: z.string().optional(), description: z.string().min(2).optional(), quantity: z.union([z.string(), z.number()]).nullable().optional(), unit: z.string().nullable().optional() }),
        execute: async (args) => observe(await operations.editSpecLine(args)),
      }),
      delete_spec_line: tool({
        description: "Запросить явное подтверждение и затем удалить одну строку только из текущего проекта.",
        inputSchema: z.object({ itemId: z.string().uuid().optional(), position: z.string().optional(), confirmationId: z.string().uuid().optional() }),
        execute: async (args) => observe(await operations.deleteSpecLine({ ...args, confirmationId: withPending(args.confirmationId) })),
      }),
      run_comparison: tool({
        description: "После подтверждения вызвать Stage 04 publish_manual_comparison для подтверждённых quotes текущего проекта.",
        inputSchema: z.object({ confirmationId: z.string().uuid().optional() }),
        execute: async ({ confirmationId }) => observe(await operations.runComparison({ confirmationId: withPending(confirmationId) })),
      }),
      apply_markup: tool({
        description: "После подтверждения передать percentage и scoped line ids в deterministic apply_estimate_percentage RPC. Не считать цены в модели.",
        inputSchema: z.object({ scope: z.enum(["selected", "all", "positions"]), positions: z.array(z.string()).optional(), percentage: z.number().gt(-100).max(1000), confirmationId: z.string().uuid().optional() }),
        execute: async (args) => observe(await operations.applyMarkup({ ...args, confirmationId: withPending(args.confirmationId) })),
      }),
      export_proposal: tool({
        description: "После подтверждения сформировать XLSX из последней сохранённой proposal version без арифметики в модели.",
        inputSchema: z.object({ confirmationId: z.string().uuid().optional() }),
        execute: async ({ confirmationId }) => {
          const exported = observe(await operations.exportProposal({ confirmationId: withPending(confirmationId) }));
          if (exported.pendingConfirmation) return { pendingConfirmation: exported.pendingConfirmation };
          if (exported.downloadUrl) action = { label: `Скачать ${String(exported.filename)}`, href: String(exported.downloadUrl) };
          return {
            documentId: exported.documentId,
            filename: exported.filename,
            proposalNumber: exported.proposalNumber,
            version: exported.version,
            grandTotal: exported.grandTotal,
            currency: exported.currency,
            summary: exported.summary,
          };
        },
      }),
      undo_estimate_operation: tool({
        description: "Отменить конкретную детерминированную percentage operation по receipt, если строки после неё не менялись.",
        inputSchema: z.object({ operationId: z.string().uuid().optional() }),
        execute: async ({ operationId }) => {
          const legacy = new EstimateOperations(input.projectId, input.selectedIds);
          receipt = await legacy.undo(operationId);
          return receipt;
        },
      }),
      navigate: tool({
        description: "Открыть экран импорта, сравнения или коммерческого предложения.",
        inputSchema: z.object({ destination: z.enum(["import", "comparison", "proposal"]) }),
        execute: async ({ destination }) => {
          action = destination === "import" ? { label: "Открыть импорт документов", href: `/projects/${input.projectId}/documents` }
            : destination === "comparison" ? { label: "Открыть сравнение", href: `/projects/${input.projectId}#compare` }
              : { label: "Открыть коммерческое предложение", href: `/projects/${input.projectId}#proposal` };
          return action;
        },
      }),
    },
  });
  return { message: result.text || confirmation?.summary || receipt?.summary || "Готово.", receipt, action, confirmation, rows: await operations.read(), mode: "agent" };
}
