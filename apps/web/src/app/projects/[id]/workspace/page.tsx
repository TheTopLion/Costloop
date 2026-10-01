import { notFound } from "next/navigation";
import { repository } from "@/lib/repository";
import { ProjectWorkspace } from "@/components/project-workspace";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? error.message : null;
    if (typeof maybeMessage === "string") return maybeMessage;
    const maybeDetails = "details" in error ? error.details : null;
    if (typeof maybeDetails === "string") return maybeDetails;
    try { return JSON.stringify(error); } catch { return "Unknown Supabase connection error"; }
  }
  return String(error);
}

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const repo = repository(); if (!repo) return <h1>Supabase is not configured</h1>;
  let project;
  try {
    project = await repo.projectWorkspace(id);
  } catch (error) {
    const message = errorMessage(error);
    return <section className="narrow">
      <p className="eyebrow">Workspace unavailable</p>
      <h1>Local Supabase is not running</h1>
      <p className="muted">Appraise cannot load the real estimate data until the local Supabase API is reachable.</p>
      <div className="empty">
        <h2>Start Docker Desktop and Supabase, then reload this page.</h2>
        <p><code>{message}</code></p>
      </div>
    </section>;
  }
  if (!project) notFound();
  return <ProjectWorkspace projectId={id} rows={project.specItems} />;
}
