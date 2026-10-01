import type { Metadata } from "next";
import Link from "next/link";
import "./styles.css";

export const metadata: Metadata = { title: "Appraise", description: "Traceable industrial cost estimation" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header><Link className="brand" href="/">Appraise</Link><nav><Link href="/projects">Projects</Link><Link href="/auth">Sign in</Link></nav></header><main>{children}</main><footer>Appraise · Traceable estimates from source to proposal</footer></body></html>;
}
