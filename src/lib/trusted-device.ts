import crypto from "node:crypto";

// 「このブラウザを覚えておく」機能。
//
// 2FAは強いが、管理画面を1日に何度も開く担当者にとって毎回6桁を打つのは重い。
// 重ければ2FAを切られてしまい、かえって弱くなる。そこで一度6桁を通したブラウザは
// 7日間だけ省略できるようにする。7日を過ぎればまた6桁を求める。
//
// 記憶はサーバに保存せず、署名付きCookieで持つ。ただし素朴に「このIDは信頼済み」と
// 書くだけだと、パスワードを変えても2FAを付け直しても古いCookieが生き続けてしまう。
// そこで現在の password_hash と totp_secret から作った指紋を token に埋め、
// どちらかが変わったら過去に記憶した全ブラウザが自動的に無効になるようにしている。
//
//   パスワード変更     → 指紋が変わる → 全ブラウザで再度6桁が必要
//   2FAの再設定/解除   → 指紋が変わる → 同上
//   パスワード再発行   → 指紋が変わる → 同上（乗っ取り時の締め出しに効く）

export const TRUSTED_DEVICE_MAX_AGE = 7 * 24 * 60 * 60; // 7日

export const TRUST_COOKIE = {
  admin: "rk_tenant_2fa",
  super: "rk_super_2fa",
} as const;

export type TrustScope = keyof typeof TRUST_COOKIE;

type TrustPayload = {
  kind: "trust2fa";
  scope: TrustScope;
  sub: string;
  fp: string;
  expires: number;
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be configured (>= 16 chars)");
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((input.length + 2) % 4);
  return Buffer.from(padded, "base64");
}

// セッションCookieの署名と混ざらないよう、用途を鍵の材料に含める
function sign(data: string): string {
  return b64url(
    crypto.createHmac("sha256", getSecret() + "|trusted-device").update(data).digest()
  );
}

/**
 * 認証情報の指紋。これが変わると、記憶済みのブラウザは一斉に無効になる。
 * ハッシュ化しているので、Cookie から password_hash や totp_secret は復元できない。
 */
export function credentialFingerprint(passwordHash: string, totpSecret: string | null): string {
  return crypto
    .createHash("sha256")
    .update(`${passwordHash}|${totpSecret ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

export function signTrustToken(scope: TrustScope, sub: string, fp: string): string {
  const payload: TrustPayload = {
    kind: "trust2fa",
    scope,
    sub,
    fp,
    expires: Math.floor(Date.now() / 1000) + TRUSTED_DEVICE_MAX_AGE,
  };
  const data = b64url(JSON.stringify(payload));
  return `${data}.${sign(data)}`;
}

/** 期待する持ち主・指紋と一致し、期限内で、署名が正しいときだけ true */
export function isTrustedDevice(
  token: string | undefined | null,
  scope: TrustScope,
  sub: string,
  fp: string
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [data, sig] = parts;
  const expected = sign(data);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  try {
    const p = JSON.parse(b64urlDecode(data).toString()) as TrustPayload;
    if (p.kind !== "trust2fa") return false;
    if (p.scope !== scope) return false;
    if (p.sub !== sub) return false;
    if (p.fp !== fp) return false;
    if (p.expires < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}
