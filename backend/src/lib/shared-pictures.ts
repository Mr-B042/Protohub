import { createHash } from "node:crypto";

/**
 * Products list: send each repeated add-on picture once (30 Oct 2026, the app
 * is slow on low-end phones). Add-on pictures are stored inside each package
 * as text, and the same few pictures are copied into many packages - 4
 * pictures were sent 48 times, about 2 MB on every sign-in. The first copy
 * keeps the picture plus an imageRef; later copies send only the imageRef and
 * the app puts the picture back (src/lib/shared-pictures.ts) before any screen
 * or save sees the list. Only when the app asks (?shared_pictures=1), so an
 * older open copy of the app still gets every picture and cannot save one away.
 */
export function shareRepeatedPictures<T>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.map((row: any) => {
    if (!Array.isArray(row?.packages)) return row;
    let changed = false;
    const packages = row.packages.map((pkg: any) => {
      if (!Array.isArray(pkg?.companion_products)) return pkg;
      const companions = pkg.companion_products.map((companion: any) => {
        const url = companion?.imageUrl;
        if (typeof url !== "string" || !url.startsWith("data:") || url.length < 2000) return companion;
        const ref = createHash("sha1").update(url).digest("hex").slice(0, 16);
        changed = true;
        if (seen.has(ref)) return { ...companion, imageUrl: "", imageRef: ref };
        seen.add(ref);
        return { ...companion, imageRef: ref };
      });
      return { ...pkg, companion_products: companions };
    });
    return changed ? { ...row, packages } : row;
  }) as T[];
}
