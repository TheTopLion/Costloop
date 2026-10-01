import Link from "next/link";

export default function Home() {
  return <section className="hero"><div><p className="eyebrow">Industrial cost estimation</p><h1>Build defensible estimates, not mystery spreadsheets.</h1><p className="lead">Bring specifications and supplier quotes into one auditable workspace. Compare like with like and keep every decision tied to its source.</p><div className="actions"><Link className="button" href="/auth">Enter workspace</Link><Link className="button secondary" href="/projects">View projects</Link></div></div><aside className="panel"><p className="eyebrow">Designed for confidence</p><h2>One source of truth</h2><ul><li>Company-isolated workspaces</li><li>Explicit currencies and decimal arithmetic</li><li>Original documents retained as evidence</li><li>Every important mutation audited</li></ul></aside></section>;
}
