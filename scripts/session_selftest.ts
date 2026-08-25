// セッションCookieの自己テスト。
// 「7日間ログインしたままにする」を入れたので、期間の切り替えと
// 期限切れ・改ざんの扱いを確かめる。
process.env.SESSION_SECRET = "test-session-secret-at-least-16-chars";

import {
  signTenantToken, verifyTenantToken,
  signSuperToken, verifySuperToken,
  SESSION_MAX_AGE, SESSION_MAX_AGE_REMEMBERED,
} from "../src/lib/tenant-session";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const ADMIN = "11111111-1111-1111-1111-111111111111";
const COMPANY = "22222222-2222-2222-2222-222222222222";
const withClock = (offsetSec: number, fn: () => void) => {
  const real = Date.now;
  try { Date.now = () => real() + offsetSec * 1000; fn(); }
  finally { Date.now = real; }
};

// --- 期間の設定値 ---
{
  ok("既定は12時間", SESSION_MAX_AGE === 60 * 60 * 12);
  ok("記憶ありは7日", SESSION_MAX_AGE_REMEMBERED === 60 * 60 * 24 * 7);
}

// --- 既定（記憶なし） ---
{
  const t = signTenantToken({ adminId: ADMIN, companyId: COMPANY });
  ok("発行直後は有効", verifyTenantToken(t) !== null);
  withClock(SESSION_MAX_AGE - 60, () => ok("12時間以内は有効", verifyTenantToken(t) !== null));
  withClock(SESSION_MAX_AGE + 60, () => ok("12時間を過ぎると無効", verifyTenantToken(t) === null));
}

// --- 記憶あり（7日） ---
{
  const t = signTenantToken({ adminId: ADMIN, companyId: COMPANY }, SESSION_MAX_AGE_REMEMBERED);
  withClock(SESSION_MAX_AGE + 60, () => ok("12時間を過ぎても有効", verifyTenantToken(t) !== null));
  withClock(SESSION_MAX_AGE_REMEMBERED - 60, () => ok("7日以内は有効", verifyTenantToken(t) !== null));
  withClock(SESSION_MAX_AGE_REMEMBERED + 60, () => ok("7日を過ぎると無効", verifyTenantToken(t) === null));
}

// --- 中身が正しく載っている ---
{
  const p = verifyTenantToken(signTenantToken({ adminId: ADMIN, companyId: COMPANY }, SESSION_MAX_AGE_REMEMBERED));
  ok("管理者IDが復元できる", p?.adminId === ADMIN);
  ok("会社IDが復元できる", p?.companyId === COMPANY);
  ok("有効期限が7日後になっている",
     !!p && Math.abs(p.expires - (Math.floor(Date.now()/1000) + SESSION_MAX_AGE_REMEMBERED)) <= 2);
}

// --- 運営者側も同じ ---
{
  const s = signSuperToken({ superAdminId: ADMIN }, SESSION_MAX_AGE_REMEMBERED);
  ok("運営者も7日保持できる", verifySuperToken(s) !== null);
  withClock(SESSION_MAX_AGE_REMEMBERED + 60, () => ok("運営者も7日で切れる", verifySuperToken(s) === null));
  ok("運営者トークンを管理画面に流用できない", verifyTenantToken(s) === null);
  const t = signTenantToken({ adminId: ADMIN, companyId: COMPANY }, SESSION_MAX_AGE_REMEMBERED);
  ok("管理者トークンを運営画面に流用できない", verifySuperToken(t) === null);
}

// --- 改ざん ---
{
  const t = signTenantToken({ adminId: ADMIN, companyId: COMPANY }, SESSION_MAX_AGE_REMEMBERED);
  const [data, sig] = t.split(".");
  ok("署名の書き換えは無効", verifyTenantToken(`${data}.${sig.slice(0,-2)}xy`) === null);
  // 期限だけ伸ばそうとしても署名が合わない
  const longer = Buffer.from(JSON.stringify({
    adminId: ADMIN, companyId: COMPANY, expires: Math.floor(Date.now()/1000) + 60*60*24*365,
  })).toString("base64url");
  ok("期限を伸ばした偽造は無効", verifyTenantToken(`${longer}.${sig}`) === null);
  ok("空は無効", verifyTenantToken("") === null);
  ok("未設定は無効", verifyTenantToken(undefined) === null);
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
