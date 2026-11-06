"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEFAULT_SECTION, DOC_SECTIONS } from "./sections";

export default function DocsSidebar() {
  const pathname = usePathname();
  // Current slug: last path segment, treating bare /docs as the default.
  const seg = pathname.replace(/^\/docs\/?/, "");
  const current = seg === "" ? DEFAULT_SECTION : seg;

  return (
    <aside className="docs-sidebar">
      <div className="kicker docs-sidebar-kicker">{"// DOCS"}</div>
      <nav className="docs-nav">
        {DOC_SECTIONS.map((s) => (
          <Link
            key={s.slug}
            href={`/docs/${s.slug}`}
            className={`docs-nav-link${current === s.slug ? " active" : ""}`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
