import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyToken } from "@/lib/admin-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!verifyToken(token)) {
      return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    }

    const limitParam = new URL(req.url).searchParams.get("limit") ?? "100";
    const limit = Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500);

    const { data, error } = await getSupabaseAdmin()
      .from("admin_audit_log")
      .select("id, action, details, ip_address, user_agent, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`supabase: ${error.message}`);

    return NextResponse.json({ ok: true, logs: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}
