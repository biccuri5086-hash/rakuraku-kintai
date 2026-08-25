import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./supabase-admin";

export type AuditAction =
  | "admin_login_success"
  | "admin_login_failure"
  | "admin_login_2fa_failure"
  | "admin_login_rate_limited"
  | "admin_login_company_select"
  | "admin_logout"
  | "admin_dashboard_view"
  | "admin_2fa_setup_view"
  | "admin_2fa_enabled"
  | "admin_2fa_disabled"
  | "admin_2fa_disable_failure"
  | "admin_password_changed"
  | "admin_password_change_failure"
  | "super_login_success"
  | "super_login_failure"
  | "super_logout"
  | "super_password_changed"
  | "super_password_change_failure"
  | "super_company_create"
  | "super_company_update"
  | "super_company_delete"
  | "super_admin_create"
  | "super_admin_delete"
  | "super_admin_password_reset"
  | "super_2fa_view"
  | "super_2fa_enabled"
  | "super_2fa_disabled"
  | "super_2fa_disable_failure"
  | "super_login_2fa_failure"
  | "tenant_violation_attempt"
  | "staff_register"
  | "staff_clock"
  | "staff_condition";

export type ActorType = "super_admin" | "admin" | "staff" | "system";

export type AuditContext = {
  actorType?: ActorType;
  actorId?: string;
  companyId?: string;
};

function getClientInfo(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? "unknown";
  return { ip, ua };
}

export async function logAudit(
  req: NextRequest,
  action: AuditAction,
  details?: Record<string, unknown>,
  context?: AuditContext
): Promise<void> {
  try {
    const { ip, ua } = getClientInfo(req);
    await getSupabaseAdmin()
      .from("admin_audit_log")
      .insert({
        action,
        details: details ?? null,
        ip_address: ip,
        user_agent: ua,
        actor_type: context?.actorType ?? null,
        actor_id: context?.actorId ?? null,
        company_id: context?.companyId ?? null,
      });
  } catch {
    /* 監査ログの失敗は本体処理を止めない */
  }
}
