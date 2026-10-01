import { createCompany } from "@/app/actions";
import { Field, Message } from "@/components/form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const configured = isSupabaseConfigured();
  return <section className="narrow"><p className="eyebrow">Workspace setup</p><h1>Create your company workspace</h1><p className="muted">Projects, documents, and decisions stay isolated to this company.</p><Message {...query} /><form action={createCompany}><Field label="Company name" name="name" required /><button disabled={!configured}>Create workspace</button></form></section>;
}
