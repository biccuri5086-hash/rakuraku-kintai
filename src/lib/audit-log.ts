import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./supabase-admin";

export type AuditAction =
  | "admin_login_success"
  | "admin_login_failure"
  | "admin_login_2fa_failure"
  | "admin_login_rate_limited"
  | "admin_logout"
  | "admin_dashboard_view"
  | "admin_2fa_setup_view";

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
  details?: Record<string, unknown>
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
      });
  } catch {
    /* 監査ログの失敗は本体処理を止めない */
  }
}
