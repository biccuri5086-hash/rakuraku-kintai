import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  TENANT_SESSION_COOKIE,
  SUPER_SESSION_COOKIE,
  TenantSessionPayload,
  SuperSessionPayload,
} from "./tenant-session";
import { resolveServerSession } from "./server-session";

export type TenantContext = {
  adminId: string;
  companyId: string;
  sessionId: string;
};

export type SuperContext = {
  superAdminId: string;
  sessionId: string;
};

// ローテーションで新しいシークレットが発行されたら、応答Cookieを差し替える。
// route handler 内から呼ばれる前提（Server Component からは呼ばれない）。
// 万一書き込み不可の文脈でも認証は継続できるよう、失敗は握りつぶす。
function applyRotatedCookie(
  store: Awaited<ReturnType<typeof cookies>>,
  name: string,
  rotated: { value: string; maxAge: number } | undefined
): void {
  if (!rotated) return;
  try {
    store.set(name, rotated.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: rotated.maxAge,
    });
  } catch {
    /* Cookie を設定できない文脈（レンダリング中など）では次回の利用時に再ローテーションされる */
  }
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const store = await cookies();
  const token = store.get(TENANT_SESSION_COOKIE)?.value;
  const session = await resolveServerSession(token);
  if (!session || session.actorType !== "admin" || !session.companyId) return null;
  applyRotatedCookie(store, TENANT_SESSION_COOKIE, session.rotatedCookie);
  return { adminId: session.actorId, companyId: session.companyId, sessionId: session.sessionId };
}

export async function getSuperContext(): Promise<SuperContext | null> {
  const store = await cookies();
  const token = store.get(SUPER_SESSION_COOKIE)?.value;
  const session = await resolveServerSession(token);
  if (!session || session.actorType !== "super_admin") return null;
  applyRotatedCookie(store, SUPER_SESSION_COOKIE, session.rotatedCookie);
  return { superAdminId: session.actorId, sessionId: session.sessionId };
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
