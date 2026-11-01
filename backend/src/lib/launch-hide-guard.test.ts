import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Product Launch guard (Bright, 1 Nov 2026: "make sure all gaps are closed,
 * nothing is leaking"). A Silent Test order may only ever reach the Owner.
 *
 * Every READ of the orders table in routes/ and lib/ must say how it treats
 * Silent Test orders, in the statement itself:
 *  - hideSilentOrders(...)  - hidden from everyone but the Owner, or
 *  - "launch_stage"         - filtered (or read) by stage, or
 *  - a `launch-safe:` note  - why this read cannot show one to anyone else
 *    (Owner-only page, a customer's own order, a lookup of ids that came from
 *    an already-filtered list, ...).
 * Writes (update / insert / upsert / delete) are not reads and are skipped.
 *
 * A new order read added without one of these fails here, so the gap cannot
 * quietly reopen.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, "..", "routes"), here];

type Site = { file: string; line: number; text: string };

export function orderReadSites(): Site[] {
  const sites: Site[] = [];
  for (const root of roots) {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || / \d+\.ts$/.test(name)) continue;
      const file = path.join(root, name);
      const source = fs.readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (!line.includes('from("orders")')) return;
        // The statement: a few lines before (a wrapping call or a note) to the
        // first line ending the chain.
        const start = Math.max(0, index - 4);
        let end = index;
        while (end < lines.length - 1 && end - index < 30 && !/;\s*$|\)\s*:\s*\{ data|\]\);?\s*$/.test(lines[end])) end += 1;
        const statement = lines.slice(start, end + 1).join("\n");
        const own = lines.slice(index, end + 1).join("\n");
        if (/\.(update|insert|upsert|delete)\(/.test(own)) return;
        // A query built in steps ("let query = ...; query = hideSilentOrders(query, ...)").
        const following = lines.slice(end + 1, end + 16).join("\n");
        if (/hideSilentOrders\(|launch_stage|launch-safe:/.test(statement) || /hideSilentOrders\(/.test(following)) return;
        sites.push({ file: `${path.basename(root)}/${name}`, line: index + 1, text: line.trim() });
      });
    }
  }
  return sites;
}

test("every order read says how it treats Silent Test orders", () => {
  const open = orderReadSites();
  assert.deepEqual(open.map((site) => `${site.file}:${site.line}`), [],
    `These order reads could show a Silent Test order to someone other than the Owner. Hide it (hideSilentOrders / .neq("launch_stage","silent")) or add a "launch-safe:" note saying why it cannot:\n${open.map((site) => `  ${site.file}:${site.line}  ${site.text}`).join("\n")}`);
});
