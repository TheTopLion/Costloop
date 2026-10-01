import Link from "next/link";
export default function NotFound() { return <section className="narrow"><h1>Project not found</h1><p>It may not exist, or your company does not have access.</p><Link className="button" href="/projects">Return to projects</Link></section>; }
