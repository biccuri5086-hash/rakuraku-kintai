// pay_rules の「改定予約」プレビュー→確定フローで使う署名付きトークン。
// プレビューAPI(preview)が計算した内容(50%変動チェック済み)と、確定API(schedule)が
// 実際に書き込む内容が食い違わないことをHMACで保証する。フロントの再送信内容を
// 信用せず、トークンの中身だけを正として書き込む。
//
// tenant-session.ts と同じ SESSION_SECRET・HMAC方式を流用（鍵管理を分散させない）。

import crypto from "node:crypto";
import { requireSessionSecret } from "./security-guard";

const TOKEN_TTL_SECONDS = 10 * 60; // プレビューから確定までの猶予（画面を開いたまま放置しても長くは有効にしない）

export type PayRuleDraft = {
  companyId: string;
  scope: "company" | "client" | "assignment";
  clientId: string | null;
  assignmentId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
  baseHourlyRate: number | null;
  overtimeRate: number;
  overtime60Rate: number;
  nightRate: number;
  holidayRate: number;
  adminId: string; // 発行者。確定APIで同一管理者かは問わないが監査のため保持
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

export function issuePayRuleToken(draft: PayRuleDraft): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = { ...draft, exp };
  const body = b64url(JSON.stringify(payload));
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifyPayRuleToken(token: string): PayRuleDraft | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  if (sig !== expected) return null;

  let payload: PayRuleDraft & { exp: number };
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;

  const draft: PayRuleDraft = { ...payload };
  return draft;
}
