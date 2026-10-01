"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Row = Record<string, unknown>;
type Disposable = { dispose: () => void };
type RangeBox = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type SheetRange = {
  getRange: () => RangeBox;
  getValues: () => unknown[][];
  getA1Notation: () => string;
  getValue: () => unknown;
  setValues: (values: unknown[][]) => void;
  getWorksheet?: () => Sheet;
};
type Sheet = {
  getRange: (row: number, column: number, rowCount?: number, columnCount?: number) => SheetRange;
  setActiveRange?: (range: SheetRange) => void;
  insertColumnsAfter?: (column: number, count: number) => void;
  deleteColumns?: (column: number, count: number) => void;
  deleteRows?: (row: number, count: number) => void;
};
type Workbook = {
  getActiveRange: () => SheetRange | null;
  getActiveSheet: () => Sheet | null;
  onSelectionChange?: (handler: (ranges: RangeBox[]) => void) => Disposable;
  undo?: () => void;
  redo?: () => void;
};
type UniverApi = {
  Event: Record<"SelectionChanged" | "SheetValueChanged", string>;
  addEvent: (eventName: string, handler: (event?: unknown) => void) => Disposable;
  createWorkbook: (data: unknown) => unknown;
  getActiveWorkbook: () => Workbook | null;
};
type UniverInstance = { dispose?: () => void };
type ValueChangedEvent = { effectedRanges?: SheetRange[] };
type Props = {
  projectId: string;
  rows: Row[];
  onRowsChange: (rows: Row[]) => void;
  onSelectionChange: (ids: string[], context: string) => void;
  onError: (message: string) => void;
};

const fields = ["position", "description", "quantity", "unit", "estimated_unit_price"] as const;
const headers = ["Позиция", "Описание", "Количество", "Ед.", "Цена", "Сумма"];

function cell(value: unknown) { return value == null ? { v: "" } : { v: value }; }
function snapshot(rows: Row[], locale: unknown) {
  const cellData: Record<number, Record<number, unknown>> = {
    0: Object.fromEntries(headers.map((value, index) => [index, { v: value, s: { bl: 1, bg: { rgb: "E8F3EE" } } }])),
  };
  rows.forEach((row, index) => {
    const r = index + 1;
    cellData[r] = {
      0: cell(row.position), 1: cell(row.description), 2: cell(row.quantity), 3: cell(row.unit),
      4: cell(row.estimated_unit_price), 5: { f: `=C${r + 1}*E${r + 1}` },
    };
  });
  return {
    id: "appraise-estimate", name: "Смета Appraise", appVersion: "1.0.0", locale,
    styles: {}, sheetOrder: ["estimate"], resources: [],
    sheets: { estimate: {
      id: "estimate", name: "Смета", rowCount: Math.max(rows.length + 100, 300), columnCount: 26,
      cellData, rowData: { 0: { h: 30 } }, columnData: { 0: { w: 100 }, 1: { w: 330 }, 2: { w: 110 }, 3: { w: 90 }, 4: { w: 130 }, 5: { w: 150 } },
      defaultColumnWidth: 100, defaultRowHeight: 26, showGridlines: 1, rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 24, hidden: 0 }, freeze: { xSplit: 0, ySplit: 1, startColumn: 0, startRow: 1 },
      mergeData: [], rowCountSegment: 20, hidden: 0, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
    } },
  };
}

export function UniverEstimateEditor({ projectId, rows, onRowsChange, onSelectionChange, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const apiRef = useRef<UniverApi | null>(null);
  const univerRef = useRef<UniverInstance | null>(null);
  const rowsRef = useRef(rows);
  const callbacksRef = useRef({ onRowsChange, onSelectionChange, onError });
  const syncing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false; let selectionDisposable: Disposable | undefined; let valueDisposable: Disposable | undefined;
    void (async () => {
      const [{ createUniver, LocaleType, mergeLocales }, core, filter, sort, coreLocale, filterLocale, sortLocale] = await Promise.all([
        import("@univerjs/presets"), import("@univerjs/preset-sheets-core"), import("@univerjs/preset-sheets-filter"), import("@univerjs/preset-sheets-sort"),
        import("@univerjs/preset-sheets-core/locales/en-US"), import("@univerjs/preset-sheets-filter/locales/en-US"), import("@univerjs/preset-sheets-sort/locales/en-US"),
      ]);
      if (disposed || !host.current) return;
      const univerBundle = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(coreLocale.default, filterLocale.default, sortLocale.default) },
        presets: [core.UniverSheetsCorePreset({ container: host.current }), filter.UniverSheetsFilterPreset(), sort.UniverSheetsSortPreset()],
      });
      const univerAPI = univerBundle.univerAPI as unknown as UniverApi;
      univerAPI.createWorkbook(snapshot(rowsRef.current, LocaleType.EN_US));
      apiRef.current = univerAPI; univerRef.current = univerBundle.univer as unknown as UniverInstance; setReady(true);

      const activeWorkbook = univerAPI.getActiveWorkbook();
      selectionDisposable = activeWorkbook?.onSelectionChange?.((ranges) => {
        const box = ranges.at(-1);
        if (!box) return;
        const selected = rowsRef.current
          .slice(Math.max(0, box.startRow - 1), Math.max(0, box.endRow))
          .map((row) => String(row.id));
        const range = activeWorkbook.getActiveSheet()?.getRange(
          box.startRow,
          box.startColumn,
          box.endRow - box.startRow + 1,
          box.endColumn - box.startColumn + 1,
        );
        const notation = range?.getA1Notation() ?? `R${box.startRow + 1}C${box.startColumn + 1}`;
        const values = range?.getValues() ?? [];
        callbacksRef.current.onSelectionChange(selected, `${notation}: ${JSON.stringify(values).slice(0, 3000)}`);
      });
      valueDisposable = univerAPI.addEvent(univerAPI.Event.SheetValueChanged, async (event?: unknown) => {
      if (syncing.current) return;
      const changedEvent = event as ValueChangedEvent | undefined;
      for (const affected of changedEvent?.effectedRanges ?? []) {
        const box = affected.getRange();
        for (let r = Math.max(1, box.startRow); r <= box.endRow; r++) {
          const row = rowsRef.current[r - 1]; if (!row) continue;
          const patch: Record<string, unknown> = {};
          const sheet = affected.getWorksheet?.();
          if (!sheet) continue;
          for (let c = box.startColumn; c <= Math.min(4, box.endColumn); c++) patch[fields[c]] = sheet.getRange(r, c).getValue();
          if (!Object.keys(patch).length) continue;
          const response = await fetch(`/api/projects/${projectId}/spec-items/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
          const result = await response.json();
          if (!response.ok) { callbacksRef.current.onError(result.error ?? "Ячейка не сохранена"); continue; }
          const next = rowsRef.current.map((item) => item.id === result.item.id ? result.item : item);
          rowsRef.current = next; callbacksRef.current.onRowsChange(next);
        }
      }
      });
    })().catch((error) => callbacksRef.current.onError(`Univer не загрузился: ${error instanceof Error ? error.message : String(error)}`));
    return () => {
      disposed = true;
      selectionDisposable?.dispose();
      valueDisposable?.dispose();

      // Univer owns nested React roots. Disposing them inside React's cleanup
      // phase triggers React's synchronous-unmount warning, so release the
      // captured instance after the current commit has completed.
      const univer = univerRef.current;
      univerRef.current = null;
      apiRef.current = null;
      setTimeout(() => univer?.dispose?.(), 0);
    };
  }, [projectId]); // Univer owns the DOM and is mounted once per project.

  useEffect(() => { callbacksRef.current = { onRowsChange, onSelectionChange, onError }; }, [onRowsChange, onSelectionChange, onError]);

  useEffect(() => {
    const sheet = apiRef.current?.getActiveWorkbook()?.getActiveSheet(); if (!sheet || !ready) return;
    syncing.current = true;
    rows.forEach((row, index) => sheet.getRange(index + 1, 0, 1, 5).setValues([[
      row.position ?? "", row.description ?? "", row.quantity ?? "", row.unit ?? "", row.estimated_unit_price ?? "",
    ]]));
    queueMicrotask(() => { syncing.current = false; });
  }, [rows, ready]);

  const workbook = () => apiRef.current?.getActiveWorkbook();
  async function addRow() {
    const response = await fetch(`/api/projects/${projectId}/spec-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Новая строка" }) });
    const result = await response.json(); if (!response.ok) return onError(result.error ?? "Строка не создана");
    const next = [...rowsRef.current, result.item]; rowsRef.current = next; onRowsChange(next);
    const sheet = workbook()?.getActiveSheet();
    if (sheet?.setActiveRange) sheet.setActiveRange(sheet.getRange(next.length, 0));
  }
  function addColumn() { const sheet = workbook()?.getActiveSheet(); const r = workbook()?.getActiveRange()?.getRange(); sheet?.insertColumnsAfter?.(r?.endColumn ?? 5, 1); }
  function deleteColumn() { const sheet = workbook()?.getActiveSheet(); const r = workbook()?.getActiveRange()?.getRange(); if (sheet?.deleteColumns && r) sheet.deleteColumns(r.startColumn, r.endColumn - r.startColumn + 1); }
  async function deleteRows() {
    const range = workbook()?.getActiveRange()?.getRange(); if (!range) return;
    const targets = rowsRef.current.slice(Math.max(0, range.startRow - 1), Math.max(0, range.endRow));
    if (!targets.length || !window.confirm(`Удалить строк: ${targets.length}?`)) return;
    const responses = await Promise.all(targets.map((row) => fetch(`/api/projects/${projectId}/spec-items/${row.id}`, { method: "DELETE" })));
    if (responses.some((response) => !response.ok)) return onError("Не все строки удалось удалить");
    const ids = new Set(targets.map((row) => row.id)); const next = rowsRef.current.filter((row) => !ids.has(row.id)); rowsRef.current = next; onRowsChange(next);
    workbook()?.getActiveSheet()?.deleteRows?.(range.startRow, targets.length);
  }
  function download() {
    const sheet = workbook()?.getActiveSheet(); if (!sheet) return;
    const values = sheet.getRange(0, 0, rowsRef.current.length + 1, 26).getValues();
    const ws = XLSX.utils.aoa_to_sheet(values); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, ws, "Смета");
    const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a"); link.href = url; link.download = "appraise-estimate.xlsx"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function importFile(file?: File) {
    if (!file) return; const array = await file.arrayBuffer(); const book = XLSX.read(array); const ws = book.Sheets[book.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    const imported = matrix.slice(1).filter((row) => row.some(Boolean)).map((row) => ({ position: row[0], description: String(row[1] || "Импортированная строка"), quantity: row[2], unit: row[3], estimated_unit_price: row[4] }));
    const response = await fetch(`/api/projects/${projectId}/spec-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: imported }) });
    const result = await response.json(); if (!response.ok) return onError(result.error ?? "XLSX не импортирован");
    window.location.reload();
  }

  return <div className="univer-editor">
    <div className="sheet-toolbar">
      <button type="button" onClick={() => void addRow()}>+ Row</button><button type="button" onClick={addColumn}>+ Column</button>
      <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>Import XLSX</button><button type="button" className="secondary" onClick={download}>Download XLSX</button>
      <button type="button" className="secondary" onClick={() => void workbook()?.undo?.()}>Undo</button><button type="button" className="secondary" onClick={() => void workbook()?.redo?.()}>Redo</button>
      <button type="button" className="sheet-danger" onClick={() => void deleteRows()}>Delete Row</button><button type="button" className="sheet-danger" onClick={deleteColumn}>Delete Column</button>
      <input ref={fileInput} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void importFile(e.target.files?.[0])}/>
    </div>
    <div ref={host} className="univer-host" />
  </div>;
}
