"use client";

import { useState } from "react";
import { UniverEstimateEditor } from "./univer-estimate-editor";
type Row = Record<string, unknown>;
type ChatAction = { label: string; href: string };
type Receipt = { operation_id: string; status: "committed" | "undone"; summary: string; rows_affected?: number };
type Confirmation = { id: string; toolName: string; summary: string };
type ChatMessage = { role: "assistant" | "user"; content: string; action?: ChatAction; receipt?: Receipt };

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function ProjectWorkspace({ projectId, rows }: { projectId: string; rows: Row[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "assistant",
    content: "Я работаю с этой сметой напрямую. Выберите строки справа и напишите, например: «Увеличь стоимость выбранных строк на 10%».",
  }]);
  const [prompt, setPrompt] = useState("");
  const [data, setData] = useState(rows);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionContext, setSelectionContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<Confirmation | undefined>();
  const currency = String(data.find((row) => row.estimated_currency)?.estimated_currency ?? "");
  const estimateTotal = data.reduce((sum, row) => sum + Number(row.estimated_line_total ?? 0), 0);

  async function ask(command?: string) {
    const text = command ?? prompt;
    if (!text.trim() || busy) return;
    setPrompt("");
    setBusy(true);
    const history = messages.map(({ role, content }) => ({ role, content })).slice(-10);
    setMessages((current) => [...current, { role: "user", content: text }]);
    try {
      const response = await fetch(`/api/projects/${projectId}/assistant`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, selectedIds, selectionContext, history, pendingConfirmationId: pendingConfirmation?.id }),
      });
      const result = await response.json();
      if (result.rows) setData(result.rows);
      setPendingConfirmation(result.confirmation);
      setMessages((current) => {
        const reconciled = result.receipt?.status === "undone"
          ? current.map((message) => message.receipt?.operation_id === result.receipt.operation_id
            ? { ...message, receipt: { ...message.receipt!, status: "undone" as const } }
            : message)
          : current;
        return [...reconciled, {
          role: "assistant", content: result.message ?? result.error ?? "Не удалось обработать запрос.", action: result.action, receipt: result.receipt,
        }];
      });
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Связь с помощником прервана. Данные не изменены." }]);
    } finally {
      setBusy(false);
    }
  }

  return <section className="simple-workspace">
    <header className="workspace-intro">
      <div><p className="eyebrow">AI + редактор</p><h1>Смета проекта</h1></div>
      <div className="estimate-total"><span>Итого по смете</span><strong>{number.format(estimateTotal)} {currency}</strong><small>{data.length} строк · выбрано {selectedIds.length}</small></div>
    </header>
    <section className="chat-grid">
      <aside className="chat-panel">
        <div className="chat-heading"><div className="agent-dot"/><div><h2>Appraise AI</h2><small>{busy ? "Выполняет tool…" : "Работает с текущей таблицей"}</small></div></div>
        <div className="chat-thread">{messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}>
          <span>{message.role === "assistant" ? "AI" : "Вы"}</span><p>{message.content}</p>
          {message.action ? <button className="chat-action" type="button" onClick={() => window.location.assign(message.action!.href)}>{message.action.label}</button> : null}
          {message.receipt ? <div className="receipt"><small>Receipt · {message.receipt.operation_id.slice(0, 8)}</small><strong>{message.receipt.status === "undone" ? "Отменено" : `${message.receipt.rows_affected ?? ""} строк изменено`}</strong>{message.receipt.status === "committed" ? <button type="button" onClick={() => void ask(`Отмени операцию ${message.receipt!.operation_id}`)}>Отменить</button> : null}</div> : null}
        </div>)}</div>
        <div className="chat-suggestions"><button type="button" onClick={() => void ask("Покажи итог сметы")}>Посчитать итог</button><button type="button" onClick={() => void ask("Покажи строки без цены")}>Найти без цены</button></div>
        <form onSubmit={(event) => { event.preventDefault(); void ask(); }}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Что изменить в смете?" rows={3}/><button disabled={busy || !prompt.trim()}>{busy ? "…" : "Отправить"}</button></form>
      </aside>
      <div className="grid-panel">
        <div className="grid-title"><div><h2>Univer spreadsheet</h2><p className="muted">Диапазоны, формулы, copy/paste и изменения сохраняются в Appraise.</p></div></div>
        <UniverEstimateEditor projectId={projectId} rows={data} onRowsChange={setData}
          onSelectionChange={(ids, context) => { setSelectedIds(ids); setSelectionContext(context); }}
          onError={(content) => setMessages((current) => [...current, { role: "assistant", content }])}/>
      </div>
    </section>
  </section>;
}
