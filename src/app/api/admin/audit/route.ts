import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  try {
    const guard = await requireTenantContext();
    if (guard.error) return guard.error;
    const { companyId } = guard.ctx;

    const limitParam = new URL(req.url).searchParams.get("limit") ?? "100";
    const limit = Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500);

    const { data, error } = await getSupabaseAdmin()
      .from("admin_audit_log")
      .select("id, action, details, ip_address, user_agent, actor_type, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`supabase: ${error.message}`);

    return NextResponse.json({ ok: true, logs: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}
