// Shared docs section metadata. The default section (overview) lives at both
// /docs and /docs/overview; the rest at /docs/<slug>.

export interface DocSection {
  slug: string;
  label: string;
}

export const DOC_SECTIONS: DocSection[] = [
  { slug: "overview", label: "Overview" },
  { slug: "vision", label: "Vision" },
  { slug: "architecture", label: "Architecture" },
  { slug: "payments", label: "Payments & Flows" },
  { slug: "contracts", label: "Contracts" },
];

export const DEFAULT_SECTION = "overview";

export function isValidSection(slug: string): boolean {
  return DOC_SECTIONS.some((s) => s.slug === slug);
}
