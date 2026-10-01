import Link from "next/link";
import { repository } from "@/lib/repository";

export default async function ProjectsPage() {
  const repo = repository();
  if (!repo) return <section><h1>Projects</h1><div className="empty"><h2>Connect Supabase to load your workspace</h2><p>Copy <code>.env.example</code> to <code>.env.local</code> and add the local or hosted project credentials.</p></div></section>;
  const workspace = await repo.workspace();
  if (!workspace) return <section className="narrow"><h1>No company workspace yet</h1><p>Create a workspace before adding projects.</p><Link className="button" href="/setup">Set up company</Link></section>;
  const projects = await repo.projects();
  return <section><div className="title-row"><div><p className="eyebrow">{workspace.companyName}</p><h1>Projects</h1></div><Link className="button" href="/projects/new">New project</Link></div>{projects.length === 0 ? <div className="empty"><h2>Your project list is empty</h2><p>Create the first project to begin a traceable estimate.</p></div> : <div className="grid">{projects.map((project) => <Link className="card" href={`/projects/${project.id}/workspace`} key={project.id}><span className="status">{project.status}</span><h2>{project.name}</h2><p>{project.client_name || "No client specified"}</p><small>{project.currency} · Updated {new Date(project.updated_at).toLocaleDateString()}</small></Link>)}</div>}</section>;
}
