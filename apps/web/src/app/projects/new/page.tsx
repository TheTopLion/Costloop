import { createProject } from "@/app/actions";
import { Field, Message } from "@/components/form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const configured = isSupabaseConfigured();
  return <section className="narrow"><p className="eyebrow">New estimate</p><h1>Create a project</h1><p className="muted">Choose the reporting currency now; source quotes can retain other currencies later.</p><Message {...query} /><form action={createProject}><Field label="Project name" name="name" required /><Field label="Client name (optional)" name="client_name" /><Field label="Reporting currency" name="currency"><select name="currency" defaultValue="KZT"><option>KZT</option><option>USD</option><option>EUR</option><option>RUB</option></select></Field><button disabled={!configured}>Create project</button></form></section>;
}
