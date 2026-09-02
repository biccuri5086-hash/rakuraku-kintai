// server-session.ts の純粋関数テスト。
// 継続ログインの期限判定・スライド・トークン検証はここが壊れると
// 「勝手にログアウト」や「失効したはずのセッションが通る」に直結する。
import {
  generateSession, hashSecret, parseSessionCookie, secretMatches,
  computeExpiries, evaluateSession, cookieMaxAge,
  IDLE_MAX_AGE_REMEMBERED, ABSOLUTE_MAX_AGE_REMEMBERED,
  IDLE_MAX_AGE_SESSION, SLIDE_THROTTLE_SEC,
  type SessionRow,
} from "../src/lib/server-session";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse("2026-09-02T00:00:00Z");

// --- トークン生成・検証 ---
{
  const g = generateSession();
  ok("cookieValue = sessionId.secret", g.cookieValue === `${g.sessionId}.${g.secret}`);
  const parsed = parseSessionCookie(g.cookieValue);
  ok("parse round-trip id", parsed?.sessionId === g.sessionId);
  ok("parse round-trip secret", parsed?.secret === g.secret);
  ok("hashSecret は16進64文字", /^[0-9a-f]{64}$/.test(hashSecret(g.secret)));
  ok("正しいsecretは一致", secretMatches(g.secret, hashSecret(g.secret)));
  ok("誤ったsecretは不一致", !secretMatches("wrong", hashSecret(g.secret)));
  ok("hashなしは不一致", !secretMatches(g.secret, null));
  ok("2回の生成は別ID", generateSession().sessionId !== generateSession().sessionId);
}

// --- Cookieパースの防御 ---
{
  ok("ドット無しは拒否", parseSessionCookie("noseparator") === null);
  ok("空は拒否", parseSessionCookie("") === null);
  ok("undefinedは拒否", parseSessionCookie(undefined) === null);
  ok("非UUIDのidは拒否", parseSessionCookie("not-a-uuid.secretpart") === null);
  ok("id側だけドット先頭は拒否", parseSessionCookie(".secret") === null);
  ok("正しいUUID.secretは許可", parseSessionCookie("11111111-1111-1111-1111-111111111111.abc") !== null);
}

// --- 期限計算 ---
{
  const r = computeExpiries(NOW, true);
  ok("remember idle=30日", r.idleTtlSeconds === IDLE_MAX_AGE_REMEMBERED);
  ok("remember idle < absolute", Date.parse(r.idleExpiresAt) < Date.parse(r.absoluteExpiresAt));
  ok("remember absolute=90日", Date.parse(r.absoluteExpiresAt) === NOW + ABSOLUTE_MAX_AGE_REMEMBERED * 1000);
  const s = computeExpiries(NOW, false);
  ok("非remember idle=12時間", s.idleTtlSeconds === IDLE_MAX_AGE_SESSION);
  ok("cookieMaxAge(remember)=90日", cookieMaxAge(true) === ABSOLUTE_MAX_AGE_REMEMBERED);
}

const row = (over: Partial<SessionRow>): SessionRow => ({
  revoked_at: null,
  idle_expires_at: iso(NOW + IDLE_MAX_AGE_REMEMBERED * 1000),
  absolute_expires_at: iso(NOW + ABSOLUTE_MAX_AGE_REMEMBERED * 1000),
  last_used_at: iso(NOW),
  idle_ttl_seconds: IDLE_MAX_AGE_REMEMBERED,
  ...over,
});

// --- セッション評価 ---
{
  ok("失効済みは revoked", evaluateSession(row({ revoked_at: iso(NOW) }), NOW + 1000).state === "revoked");

  ok("絶対上限超過は absolute_expired",
    evaluateSession(row({}), NOW + (ABSOLUTE_MAX_AGE_REMEMBERED + 10) * 1000).state === "absolute_expired");

  ok("アイドル超過は idle_expired",
    evaluateSession(row({ idle_expires_at: iso(NOW + 1000) }), NOW + 5000).state === "idle_expired");

  // 直近使用 → スライドしない
  const fresh = evaluateSession(row({ last_used_at: iso(NOW) }), NOW + 1000);
  ok("直近使用はスライドしない", fresh.state === "valid" && fresh.slide === false);

  // 前回使用が閾値超え → スライドする
  const stale = evaluateSession(row({ last_used_at: iso(NOW) }), NOW + (SLIDE_THROTTLE_SEC + 60) * 1000);
  ok("放置後の利用はスライドする", stale.state === "valid" && stale.slide === true);
  if (stale.state === "valid") {
    const usedAt = NOW + (SLIDE_THROTTLE_SEC + 60) * 1000;
    ok("スライド後のアイドル期限 = 利用時刻+ttl",
      Date.parse(stale.nextIdleExpiresAt) === usedAt + IDLE_MAX_AGE_REMEMBERED * 1000);
  }

  // スライドが絶対上限を超えない（now は上限より手前だが now+idle_ttl は上限超過）
  const cap = NOW + (SLIDE_THROTTLE_SEC + 120) * 1000;
  const nearCap = evaluateSession(
    row({ last_used_at: iso(NOW), absolute_expires_at: iso(cap) }),
    NOW + (SLIDE_THROTTLE_SEC + 60) * 1000
  );
  ok("スライドは絶対上限で頭打ち",
    nearCap.state === "valid" && Date.parse(nearCap.nextIdleExpiresAt) === cap);

  ok("壊れた日時は malformed",
    evaluateSession(row({ idle_expires_at: "not-a-date" }), NOW).state === "malformed");
}

if (failed > 0) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nserver_session_selftest: all passed");
