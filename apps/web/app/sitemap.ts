import type { MetadataRoute } from "next";

import {
  docsFilePath,
  docsHref,
  lastModifiedFor,
  publicDocs,
} from "@/lib/docs-pages";
import { siteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await publicDocs();
  const home: MetadataRoute.Sitemap[number] = {
    url: siteUrl,
    lastModified: lastModifiedFor(`${process.cwd()}/app/page.tsx`),
  };
  const pages = docs.map((doc) => ({
    url: `${siteUrl}${docsHref(doc.slug)}`,
    lastModified: lastModifiedFor(docsFilePath(doc.slug)),
  }));
  return [home, ...pages];
}
