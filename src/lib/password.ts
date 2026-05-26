import crypto from "node:crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;
const SCRYPT_COST = 16384;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = crypto.scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = parseInt(parts[1], 10);
  if (!Number.isFinite(cost)) return false;
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  const derived = crypto.scryptSync(plain, salt, expected.length, { N: cost });
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
