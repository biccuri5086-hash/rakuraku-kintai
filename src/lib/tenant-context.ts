import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "./supabase-admin";
import { isTrialStopped } from "./billing/trial-notice";
import {
  TENANT_SESSION_COOKIE,
  SUPER_SESSION_COOKIE,
  verifyTenantToken,
  verifySuperToken,
  TenantSessionPayload,
  SuperSessionPayload,
} from "./tenant-session";

export type TenantContext = {
  adminId: string;
  companyId: string;
};

export type SuperContext = {
  superAdminId: string;
};

// 解約(cancelled)・停止(suspended)された会社は、署名済みセッションが残っていても
// 即座に締め出す。セッションは最長7日間有効なため、ここでDB側のstatusを都度確認しないと
// 解約後も期限まで管理画面が使えてしまう(テナント削除自動化_設計.md 参照)。
export async function isCompanyBlocked(companyId: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from("companies")
    .select("*") // trial_decision 列は後から追加された(0010)ため、未適用でも落ちないよう * で読む
    .eq("id", companyId)
    .maybeSingle();
  if (!data) return true;
  if (data.status === "cancelled" || data.status === "suspended") return true;
  // トライアル終了時に「やめる」を選んだ会社は、終了日を過ぎたら締め出す
  return isTrialStopped(data.status, data.trial_ends_at, data.trial_decision);
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const store = await cookies();
  const token = store.get(TENANT_SESSION_COOKIE)?.value;
  const payload = verifyTenantToken(token);
  if (!payload) return null;
  if (await isCompanyBlocked(payload.companyId)) return null;
  return { adminId: payload.adminId, companyId: payload.companyId };
}

export async function getSuperContext(): Promise<SuperContext | null> {
  const store = await cookies();
  const token = store.get(SUPER_SESSION_COOKIE)?.value;
  const payload = verifySuperToken(token);
  if (!payload) return null;
  return { superAdminId: payload.superAdminId };
}

export async function requireTenantContext(): Promise<
  { ctx: TenantContext; error?: undefined } | { ctx?: undefined; error: NextResponse }
> {
  const ctx = await getTenantContext();
  if (!ctx) {
    return { error: NextResponse.json({ ok: false, message: "未認証" }, { status: 401 }) };
  }
  return { ctx };
}

export async function requireSuperContext(): Promise<
  { ctx: SuperContext; error?: undefined } | { ctx?: undefined; error: NextResponse }
> {
  const ctx = await getSuperContext();
  if (!ctx) {
    return { error: NextResponse.json({ ok: false, message: "未認証" }, { status: 401 }) };
  }
  return { ctx };
}

const TENANT_SCOPED_TABLES = new Set<string>([
  "user_profiles",
  "attendance",
  "condition_reports",
]);

export function tenantQuery(companyId: string, table: string) {
  if (!companyId) throw new Error("tenantQuery: companyId required");
  if (!TENANT_SCOPED_TABLES.has(table)) {
    throw new Error(`tenantQuery: table "${table}" is not tenant-scoped`);
  }
  return getSupabaseAdmin().from(table);
}

export function withTenantFilter<T extends { eq: (col: string, val: unknown) => T }>(
  builder: T,
  companyId: string
): T {
  if (!companyId) throw new Error("withTenantFilter: companyId required");
  return builder.eq("company_id", companyId);
}

export function assertSameTenant(row: { company_id?: string | null } | null | undefined, companyId: string): void {
  if (!row) return;
  if (row.company_id !== companyId) {
    throw new Error(`tenant_violation: expected ${companyId}, got ${row.company_id ?? "null"}`);
  }
}

export function getClientInfo(req: NextRequest): { ip: string; ua: string } {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip") ?? "unknown";
  const ua = req.headers.get("user-agent") ?? "unknown";
  return { ip, ua };
}

export type { TenantSessionPayload, SuperSessionPayload };
