// Password hashing + session tokens (Cloudflare Workers compatible, WebCrypto only).

const ITERATIONS = 120000;

export function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuf(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ?? bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBuf(salt) as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { salt, hash: bufToHex(new Uint8Array(bits)) };
}

/** Constant-time-ish comparison to avoid trivial timing leaks. */
export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHex: string
): Promise<boolean> {
  let got: string;
  try {
    got = (await hashPassword(password, saltHex)).hash;
  } catch {
    return false;
  }
  if (got.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

export function newSessionToken(): string {
  return bufToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function sessionExpiryIso(): string {
  return new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
}
