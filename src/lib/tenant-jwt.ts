// 案A(限定カギ方式)：service_role(全テーブルにアクセスできる万能キー)を使わずに、
// 「この会社のデータしか読み書きできない」PostgRESTロール(app_tenant)向けの
// 署名付きアクセストークンを発行する。
//
// これはCookie署名(tenant-session.ts)とは別物。tenant-session.tsは「このブラウザが
// どの管理者としてログイン中か」をこのサーバーだけが検証すればよいので、独自の2partフォーマット
// で十分だった。こちらはSupabase(PostgREST)という別サーバーに検証してもらう必要があるため、
// PostgRESTが理解できる標準的なJWT(3part、HS256)で発行する。
//
// このトークンが漏れても影響は「1社分のデータへの、短時間(TTL秒)だけのアクセス」に留まる
// (service_role漏洩＝全社データ、との違い)。company_idはログイン済みセッション
// (tenant-context.tsのTenantContext)からのみ渡すこと。リクエスト由来の値を渡さない。
import crypto from "node:crypto";
import { requireSupabaseJwtSecret } from "./security-guard";

export const TENANT_JWT_ROLE = "app_tenant";
export const TENANT_JWT_TTL_SECONDS = 60;

export type TenantJwtPayload = {
  role: string;
  company_id: string;
  aud: string;
  iat: number;
  exp: number;
};

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((input.length + 2) % 4);
  return Buffer.from(padded, "base64");
}

const JWT_HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function sign(signingInput: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(signingInput).digest());
}

// companyId・secretを直接渡す形。単体テスト(scripts/tenant_jwt_selftest.ts)から
// 環境変数に依存せず呼べるようにするため、環境変数読み出しはmintTenantAccessToken側に寄せる。
export function signTenantAccessToken(
  companyId: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  if (!companyId) throw new Error("signTenantAccessToken: companyId required");
  const payload: TenantJwtPayload = {
    role: TENANT_JWT_ROLE,
    company_id: companyId,
    aud: "authenticated",
    iat: nowSeconds,
    exp: nowSeconds + TENANT_JWT_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${JWT_HEADER}.${body}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

export function verifyTenantAccessToken(
  token: string | undefined | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): TenantJwtPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = sign(`${header}.${body}`, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString()) as TenantJwtPayload;
    if (payload.role !== TENANT_JWT_ROLE) return null;
    if (!payload.company_id) return null;
    if (payload.exp < nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

// アプリ側(APIルート)から呼ぶ入口。SUPABASE_JWT_SECRETが弱い/未設定ならフェイルクローズ。
export function mintTenantAccessToken(companyId: string): string {
  const secret = requireSupabaseJwtSecret(process.env.SUPABASE_JWT_SECRET);
  return signTenantAccessToken(companyId, secret);
}
