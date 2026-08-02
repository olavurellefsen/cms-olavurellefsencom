import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="not-found">
      <p className="eyebrow">404 · Off the chart</p>
      <h1>This page is not here.</h1>
      <p>The address may have changed, or the note may still be a draft.</p>
      <Link className="text-link" href="/">
        Return home <span aria-hidden="true">↗</span>
      </Link>
    </main>
  );
}
