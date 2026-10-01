import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function generateProposalWorkbook(payload: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const workerRoot = path.resolve(process.cwd(), "../worker");
    const localPython = path.join(workerRoot, ".venv", "Scripts", "python.exe");
    const python = process.env.APPRAISE_PYTHON ?? (existsSync(localPython) ? localPython : "python");
    const child = spawn(python, ["-m", "appraise_worker.proposal_export_cli"], {
      cwd: workerRoot,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let errorOutput = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Proposal export timed out."));
    }, 60_000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Proposal export worker is unavailable."));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 25 * 1024 * 1024) {
        child.kill();
        reject(new Error("Generated proposal exceeded the 25 MB limit."));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput = (errorOutput + chunk.toString("utf8")).slice(-4000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(errorOutput || "Proposal export failed."));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
