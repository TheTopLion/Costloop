import type { ReactNode } from "react";

export function Field({ label, name, type = "text", required = false, children }: { label: string; name: string; type?: string; required?: boolean; children?: ReactNode }) {
  return <label><span>{label}</span>{children ?? <input name={name} type={type} required={required} />}</label>;
}

export function Message({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return <p className={error ? "message error" : "message"}>{error ?? notice}</p>;
}
