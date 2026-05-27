import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.PHONE_ENCRYPTION_KEY;
  if (!raw) throw new Error("PHONE_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PHONE_ENCRYPTION_KEY must decode to 32 bytes (base64-encoded 256-bit key)");
  }
  return key;
}

function getHmacKey(): Buffer {
  const raw = process.env.PHONE_HASH_KEY;
  if (!raw) throw new Error("PHONE_HASH_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error("PHONE_HASH_KEY must decode to at least 32 bytes");
  }
  return key;
}

export function encryptPhone(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), enc.toString("base64"), tag.toString("base64")].join(":");
}

export function decryptPhone(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return payload;
  }
  const iv = Buffer.from(parts[1], "base64");
  const data = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error("encrypted payload format invalid");
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hashPhone(plaintext: string): string {
  return crypto.createHmac("sha256", getHmacKey()).update(plaintext).digest("base64url");
}

export function maskPhone(plaintext: string): string {
  if (plaintext.length < 4) return "***";
  return plaintext.slice(0, 3) + "****" + plaintext.slice(-4);
}
