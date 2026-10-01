import { signIn, signUp } from "@/app/actions";
import { Field, Message } from "@/components/form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const configured = isSupabaseConfigured();
  return <section className="narrow"><p className="eyebrow">Secure access</p><h1>Sign in to Appraise</h1><p className="muted">Use your company account. New users can register below.</p><Message {...query} />{!configured && <Message error="Authentication is unavailable until the Supabase environment variables are configured." />}<form><Field label="Work email" name="email" type="email" required /><Field label="Password" name="password" type="password" required /><div className="actions"><button formAction={signIn} disabled={!configured}>Sign in</button><button className="secondary" formAction={signUp} disabled={!configured}>Register</button></div></form></section>;
}
