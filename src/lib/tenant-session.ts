import crypto from "node:crypto";
import { requireSessionSecret } from "./security-guard";

export const TENANT_SESSION_COOKIE = "rk_tenant_session";
export const SUPER_SESSION_COOKIE = "rk_super_session";
export const SESSION_MAX_AGE = 60 * 60 * 12;
// ログイン時に「このブラウザでログインしたままにする」を選んだ場合の期間。
// 2FAの記憶(TRUSTED_DEVICE_MAX_AGE)と同じ7日に揃えてある。
// パスワードは保存しない。セッションを長く保つことで再入力を不要にしている。
export const SESSION_MAX_AGE_REMEMBERED = 60 * 60 * 24 * 7;

export type TenantSessionPayload = {
  adminId: string;
  companyId: string;
  expires: number;
};

export type SuperSessionPayload = {
  superAdminId: string;
  expires: number;
};

function getSecret(): string {
  return requireSessionSecret(process.env.SESSION_SECRET);
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((input.length + 2) % 4);
  return Buffer.from(padded, "base64");
}

function sign(data: string): string {
  return b64url(crypto.createHmac("sha256", getSecret()).update(data).digest());
}

export function signTenantToken(
  payload: Omit<TenantSessionPayload, "expires">,
  maxAge: number = SESSION_MAX_AGE
): string {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const data = b64url(JSON.stringify({ ...payload, expires }));
  return `${data}.${sign(data)}`;
}

export function verifyTenantToken(token: string | undefined | null): TenantSessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = sign(data);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(data).toString()) as TenantSessionPayload;
    if (!payload.adminId || !payload.companyId) return null;
    if (payload.expires < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function signSuperToken(
  payload: Omit<SuperSessionPayload, "expires">,
  maxAge: number = SESSION_MAX_AGE
): string {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const data = b64url(JSON.stringify({ ...payload, expires, kind: "super" }));
  return `${data}.${sign(data)}`;
}

export function verifySuperToken(token: string | undefined | null): SuperSessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = sign(data);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const raw = JSON.parse(b64urlDecode(data).toString()) as SuperSessionPayload & { kind?: string };
    if (raw.kind !== "super") return null;
    if (!raw.superAdminId) return null;
    if (raw.expires < Math.floor(Date.now() / 1000)) return null;
    return { superAdminId: raw.superAdminId, expires: raw.expires };
  } catch {
    return null;
  }
}
