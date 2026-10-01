import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_FETCH_TIMEOUT_MS = 5000;

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) throw new Error("Supabase environment is not configured");
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (values: { name: string; value: string; options: CookieOptions }[]) => {
          try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* RSC refreshes middleware-side. */ }
        },
      },
    },
  );
}
