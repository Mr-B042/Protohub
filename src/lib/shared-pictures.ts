/**
 * Puts back the add-on pictures the products list sent only once
 * (backend/src/lib/shared-pictures.ts). Runs on the raw list before anything
 * else reads it, and removes imageRef so it is never saved back.
 */
export function restoreSharedPictures<T>(rows: T[]): T[] {
  const pictures = new Map<string, string>();
  const companionsOf = (row: any) => (Array.isArray(row?.packages) ? row.packages : [])
    .flatMap((pkg: any) => (Array.isArray(pkg?.companion_products) ? pkg.companion_products : []));
  for (const row of rows) {
    for (const companion of companionsOf(row)) {
      if (companion?.imageRef && companion.imageUrl) pictures.set(companion.imageRef, companion.imageUrl);
    }
  }
  for (const row of rows) {
    for (const companion of companionsOf(row)) {
      if (!companion?.imageRef) continue;
      if (!companion.imageUrl) companion.imageUrl = pictures.get(companion.imageRef) ?? "";
      delete companion.imageRef;
    }
  }
  return rows;
}
