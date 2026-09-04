import { NextRequest, NextResponse } from "next/server";
import { getLineSessionCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { resolveSessionState } from "@/lib/attendance-session";

// 夜勤（日跨ぎ）に対応するため、カレンダー日ではなく直近の勤務セッションを返す。
const LOOKBACK_HOURS = 72;

export async function GET(req: NextRequest) {
  try {
    const session = await getLineSessionCached(req);
    if (!session) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const { user, companyId } = session;

    if (!companyId) {
      return NextResponse.json({ ok: true, clockIn: null, clockOut: null, stale: false });
    }

    const supabase = getSupabaseAdmin();
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
    const { data, error } = await supabase
      .from("attendance")
      .select("type, timestamp")
      .eq("user_id", user.userId)
      .eq("company_id", companyId)
      .gte("timestamp", since)
      .order("timestamp", { ascending: false })
      .limit(10);

    if (error) throw new Error(`supabase: ${error.message}`);

    const state = resolveSessionState((data ?? []) as { type: string; timestamp: string }[]);

    switch (state.kind) {
      case "working":
        return NextResponse.json({ ok: true, clockIn: state.openedAt, clockOut: null, stale: false });
      case "completed":
        return NextResponse.json({ ok: true, clockIn: state.openedAt, clockOut: state.closedAt, stale: false });
      case "stale":
        // 退勤打刻漏れ。当日の出勤は妨げないが、画面で注意を促す。
        return NextResponse.json({ ok: true, clockIn: null, clockOut: null, stale: true });
      default:
        return NextResponse.json({ ok: true, clockIn: null, clockOut: null, stale: false });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
