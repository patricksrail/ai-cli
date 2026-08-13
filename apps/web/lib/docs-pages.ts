import { statSync } from "node:fs";
import path from "node:path";

import { getAllDocs } from "fromsrc";

export const DOCS_DIR = "docs";
export const FALLBACK_LASTMOD = new Date("2026-08-13T00:00:00.000Z");

export function docsHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function docsFilePath(slug: string): string {
  return path.join(process.cwd(), DOCS_DIR, `${slug || "index"}.mdx`);
}

export function lastModifiedFor(
  filePath: string,
  fallback: Date = FALLBACK_LASTMOD
): Date {
  try {
    return statSync(filePath).mtime;
  } catch {
    return fallback;
  }
}

export async function publicDocs() {
  const docs = await getAllDocs(DOCS_DIR);
  return [...docs].toSorted((a, b) => (a.order ?? 99) - (b.order ?? 99));
}
