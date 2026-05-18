import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error("Invalid base32 character");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buf: Buffer): string {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let result = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    result += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const rem = bits.length % 5;
  if (rem > 0) {
    const last = bits.slice(-rem).padEnd(5, "0");
    result += BASE32_ALPHABET[parseInt(last, 2)];
  }
  return result;
}

function generateTOTP(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

export function verifyTOTP(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    try {
      if (generateTOTP(secret, now + w) === code) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function buildOtpAuthUrl(secret: string, account: string, issuer: string): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params}`;
}

export function isTotpEnabled(): boolean {
  return !!process.env.ADMIN_TOTP_SECRET;
}
