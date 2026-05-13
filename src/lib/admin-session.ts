import crypto from "node:crypto";

export const SESSION_COOKIE = "admin_session";
export const SESSION_MAX_AGE = 60 * 60 * 12;

function getSecret(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD is not configured");
  return pw;
}

export function signToken(): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = String(expires);
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expires = parseInt(payload, 10);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}
