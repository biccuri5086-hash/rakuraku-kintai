// tenant-jwt.ts の自己テスト。
// 案A(限定カギ方式)の要。このトークンの検証がザルだと、RLSに渡すcompany_idクレームを
// 偽造されて他社データに到達しうる。署名検証・有効期限・改ざん検知を重点的に確認する。
import {
  signTenantAccessToken,
  verifyTenantAccessToken,
  TENANT_JWT_ROLE,
  TENANT_JWT_TTL_SECONDS,
} from "../src/lib/tenant-jwt";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const SECRET_A = "Zx9Kq2Lp7Vt4Rw8Nb1Mc6Yf3Hg5Ds0Aj"; // 高エントロピーなテスト用鍵
const SECRET_B = "Qw3Er7Ty1Ui9Op5As2Df8Gh4Jk6Lz0Xc";
const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const NOW = 1_700_000_000;

// --- 正常系：発行→検証のラウンドトリップ ---
{
  const token = signTenantAccessToken(COMPANY_A, SECRET_A, NOW);
  const payload = verifyTenantAccessToken(token, SECRET_A, NOW);
  ok("発行したトークンは同じ鍵・時刻内で検証に通る", payload !== null);
  ok("company_idクレームが一致", payload?.company_id === COMPANY_A);
  ok("roleクレームがapp_tenant固定", payload?.role === TENANT_JWT_ROLE);
  ok("トークンは3part(header.payload.signature)", token.split(".").length === 3);
}

// --- 有効期限 ---
{
  const token = signTenantAccessToken(COMPANY_A, SECRET_A, NOW);
  const justBefore = verifyTenantAccessToken(token, SECRET_A, NOW + TENANT_JWT_TTL_SECONDS);
  const justAfter = verifyTenantAccessToken(token, SECRET_A, NOW + TENANT_JWT_TTL_SECONDS + 1);
  ok("TTLちょうどはまだ有効", justBefore !== null);
  ok("TTLを1秒でも過ぎたら拒否", justAfter === null);
}

// --- 署名鍵の不一致 ---
{
  const token = signTenantAccessToken(COMPANY_A, SECRET_A, NOW);
  ok("鍵が違うと検証に失敗", verifyTenantAccessToken(token, SECRET_B, NOW) === null);
}

// --- 改ざん検知(company_idを書き換えて他社になりすまそうとするケース) ---
{
  const token = signTenantAccessToken(COMPANY_A, SECRET_A, NOW);
  const [header, body, sig] = token.split(".");
  const decoded = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  const forged = { ...decoded, company_id: COMPANY_B };
  const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const forgedToken = `${header}.${forgedBody}.${sig}`; // 署名は元のまま使い回す
  ok("company_idを書き換えて署名を使い回しても拒否される", verifyTenantAccessToken(forgedToken, SECRET_A, NOW) === null);
}

// --- 異常な入力 ---
{
  ok("companyId空文字は発行時に例外", (() => {
    try { signTenantAccessToken("", SECRET_A, NOW); return false; } catch { return true; }
  })());
  ok("partが足りないトークンは拒否", verifyTenantAccessToken("a.b", SECRET_A, NOW) === null);
  ok("未定義トークンは拒否", verifyTenantAccessToken(undefined, SECRET_A, NOW) === null);
  ok("空文字トークンは拒否", verifyTenantAccessToken("", SECRET_A, NOW) === null);
  ok("roleクレームが違えば拒否", (() => {
    // 手動でrole違いのペイロードを組み立てて署名する(mintは常にapp_tenant固定なので直接テストできない経路)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const payload = { role: "service_role", company_id: COMPANY_A, aud: "authenticated", iat: NOW, exp: NOW + 60 };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const crypto = require("node:crypto");
    const sig = crypto.createHmac("sha256", SECRET_A).update(`${header}.${body}`).digest("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return verifyTenantAccessToken(`${header}.${body}.${sig}`, SECRET_A, NOW) === null;
  })());
}

if (failed > 0) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\ntenant_jwt_selftest: all passed");
