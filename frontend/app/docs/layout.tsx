import type { ReactNode } from "react";
import DocsSidebar from "./DocsSidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-wrap">
      <DocsSidebar />
      <div className="docs-content">{children}</div>
    </div>
  );
}
