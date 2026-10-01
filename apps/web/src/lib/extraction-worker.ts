import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Local worker transport. All arguments are fixed; uploaded content goes over stdin. */
export function extractDocument(filename: string, bytes: Buffer, kind: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const workerRoot = path.resolve(process.cwd(), "../worker");
    const localPython = path.join(workerRoot, ".venv", "Scripts", "python.exe");
    const python = process.env.APPRAISE_PYTHON ?? (existsSync(localPython) ? localPython : "python");
    const child = spawn(python, ["-m", "appraise_worker.extract_cli"], {
      cwd: workerRoot, shell: false, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Extraction timed out. Retry the document.")); }, 120_000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("Document worker is unavailable. Check the worker installation.")); });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 12_000_000) { child.kill(); reject(new Error("Extraction exceeds the review size limit.")); }
    });
    child.stderr.on("data", (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString("utf8")).slice(-2000); });
    child.stdin.on("error", () => { /* Process exit below reports extraction failure. */ });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(errorOutput.trim() || "Document extraction failed.")); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error("The worker returned an invalid extraction response.")); }
    });
    child.stdin.end(JSON.stringify({ filename, content_base64: bytes.toString("base64"), kind }));
  });
}
