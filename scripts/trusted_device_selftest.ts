// 「このブラウザを7日間記憶する」の自己テスト。
// このCookieが通ると2FAが省略されるため、他人のCookieや古いCookieが
// 通らないことを重点的に確かめる。
process.env.SESSION_SECRET = "test-session-secret-at-least-16-chars";

import {
  signTrustToken, isTrustedDevice, credentialFingerprint,
  TRUSTED_DEVICE_MAX_AGE, TRUST_COOKIE,
} from "../src/lib/trusted-device";
import { signTenantToken } from "../src/lib/tenant-session";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const ADMIN = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const HASH  = "scrypt$16384$aaaa$bbbb";
const SEC   = "JBSWY3DPEHPK3PXP";
const fp = credentialFingerprint(HASH, SEC);

// --- 正常系 ---
{
  const t = signTrustToken("admin", ADMIN, fp);
  ok("発行したブラウザは信頼される", isTrustedDevice(t, "admin", ADMIN, fp));
}

// --- 他人のCookieは使えない ---
{
  const t = signTrustToken("admin", ADMIN, fp);
  ok("別の管理者では通らない", !isTrustedDevice(t, "admin", OTHER, fp));
  ok("運営者側では通らない（用途違い）", !isTrustedDevice(t, "super", ADMIN, fp));

  const s = signTrustToken("super", ADMIN, fp);
  ok("運営者のCookieを管理画面に使えない", !isTrustedDevice(s, "admin", ADMIN, fp));
}

// --- 認証情報が変わったら記憶は失効する ---
{
  const t = signTrustToken("admin", ADMIN, fp);
  ok("パスワードを変えると失効", !isTrustedDevice(t, "admin", ADMIN, credentialFingerprint("scrypt$16384$cccc$dddd", SEC)));
  ok("2FAを付け直すと失効", !isTrustedDevice(t, "admin", ADMIN, credentialFingerprint(HASH, "NEWSECRET2345678")));
  ok("2FAを解除すると失効", !isTrustedDevice(t, "admin", ADMIN, credentialFingerprint(HASH, null)));
  ok("同じ認証情報なら通り続ける", isTrustedDevice(t, "admin", ADMIN, credentialFingerprint(HASH, SEC)));
}

// --- 改ざん ---
{
  const t = signTrustToken("admin", ADMIN, fp);
  const [data, sig] = t.split(".");
  ok("署名を書き換えると通らない", !isTrustedDevice(`${data}.${sig.slice(0, -2)}xy`, "admin", ADMIN, fp));
  ok("本体を書き換えると通らない", !isTrustedDevice(`${data.slice(0, -2)}xy.${sig}`, "admin", ADMIN, fp));

  // 中身を自分で作り直しても、署名鍵が無いので通らない
  const forged = Buffer.from(JSON.stringify({
    kind: "trust2fa", scope: "admin", sub: OTHER, fp,
    expires: Math.floor(Date.now()/1000) + 99999,
  })).toString("base64url");
  ok("偽造した本体は通らない", !isTrustedDevice(`${forged}.${sig}`, "admin", OTHER, fp));
}

// --- 期限 ---
{
  const t = signTrustToken("admin", ADMIN, fp);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + (TRUSTED_DEVICE_MAX_AGE - 60) * 1000;
    ok("7日以内なら通る", isTrustedDevice(t, "admin", ADMIN, fp));
    Date.now = () => realNow() + (TRUSTED_DEVICE_MAX_AGE + 60) * 1000;
    ok("7日を過ぎると通らない", !isTrustedDevice(t, "admin", ADMIN, fp));
  } finally {
    Date.now = realNow;
  }
  ok("記憶の期限は7日", TRUSTED_DEVICE_MAX_AGE === 7 * 24 * 60 * 60);
}

// --- 別種のトークンを流用できない ---
{
  const session = signTenantToken({ adminId: ADMIN, companyId: "c1" });
  ok("セッションCookieは記憶Cookieとして通らない", !isTrustedDevice(session, "admin", ADMIN, fp));
}

// --- 壊れた入力 ---
{
  ok("未設定(undefined)は通らない", !isTrustedDevice(undefined, "admin", ADMIN, fp));
  ok("空文字は通らない", !isTrustedDevice("", "admin", ADMIN, fp));
  ok("ドット無しは通らない", !isTrustedDevice("abcdef", "admin", ADMIN, fp));
  ok("ドットだらけは通らない", !isTrustedDevice("a.b.c.d", "admin", ADMIN, fp));
  ok("base64でない本体は通らない", !isTrustedDevice("!!!.###", "admin", ADMIN, fp));
}

// --- 指紋 ---
{
  ok("同じ入力なら同じ指紋", credentialFingerprint(HASH, SEC) === credentialFingerprint(HASH, SEC));
  ok("パスワードが違えば別の指紋", credentialFingerprint(HASH, SEC) !== credentialFingerprint(HASH + "x", SEC));
  ok("2FAが違えば別の指紋", credentialFingerprint(HASH, SEC) !== credentialFingerprint(HASH, SEC + "X"));
  ok("指紋は32桁の16進", /^[0-9a-f]{32}$/.test(fp));
  ok("指紋から元の値は読み取れない", !fp.includes(SEC) && !fp.includes("scrypt"));
}

// --- Cookie名が用途ごとに分かれている ---
{
  ok("管理画面と運営画面でCookie名が違う", String(TRUST_COOKIE.admin) !== String(TRUST_COOKIE.super));
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
