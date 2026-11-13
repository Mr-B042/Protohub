import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts secrets kept in the database (Meta app secret, Page keys) with
// AES-256-GCM. Key: SOCIAL_SECRET_KEY (64 hex chars) if set, otherwise derived
// from the server's Supabase service key, which never leaves the server.
// Changing either means reconnecting (old values can no longer be read).

function key(): Buffer {
  const hex = process.env.SOCIAL_SECRET_KEY?.trim();
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("No server key to protect secrets with.");
  return createHash("sha256").update(`protohub:social-secret:${base}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

/** null when the value was sealed with another key or was changed. */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed || !sealed.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
