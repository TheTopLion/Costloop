import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function generateMatches(specification: Record<string, unknown>[], quotes: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const workerRoot = path.resolve(process.cwd(), "../worker");
    const localPython = path.join(workerRoot, ".venv", "Scripts", "python.exe");
    const python = process.env.APPRAISE_PYTHON ?? (existsSync(localPython) ? localPython : "python");
    const child = spawn(python, ["-m", "appraise_worker.match_cli"], { cwd: workerRoot, shell: false, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let errorOutput = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Matching timed out. Retry the comparison.")); }, 60_000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("Matching worker is unavailable. Check the worker installation.")); });
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString("utf8")).slice(-2000); });
    child.on("close", (code) => { clearTimeout(timer); if (code !== 0) { reject(new Error(errorOutput || "Matching failed.")); return; } try { resolve(JSON.parse(output)); } catch { reject(new Error("The matching worker returned an invalid response.")); } });
    child.stdin.end(JSON.stringify({ specification, quotes }));
  });
}
