import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { resolveSessionState, canPunch, PunchType } from "@/lib/attendance-session";

// セッション判定に必要な直近の打刻だけを見る（夜勤の日跨ぎに対応するためカレンダー日では区切らない）。
const LOOKBACK_HOURS = 72;

export async function POST(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    let type: PunchType;
    try {
      const body = await req.json();
      if (body.type !== "clock_in" && body.type !== "clock_out") {
        return NextResponse.json({ ok: false, message: "type が不正です" }, { status: 400 });
      }
      type = body.type;
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("company_id")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (!profile?.company_id) {
      return NextResponse.json({ ok: false, message: "プロフィール未登録です。先にスタッフ登録を済ませてください。" }, { status: 400 });
    }

    const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
    const { data: recent } = await supabase
      .from("attendance")
      .select("type, timestamp")
      .eq("user_id", user.userId)
      .eq("company_id", profile.company_id)
      .gte("timestamp", since)
      .order("timestamp", { ascending: false })
      .limit(10);

    const state = resolveSessionState((recent ?? []) as { type: string; timestamp: string }[]);
    const decision = canPunch(type, state);
    if (!decision.allowed) {
      return NextResponse.json({ ok: false, message: decision.message }, { status: decision.status });
    }

    const { data, error } = await supabase
      .from("attendance")
      .insert({
        user_id: user.userId,
        user_name: user.displayName,
        type,
        timestamp: new Date().toISOString(),
        company_id: profile.company_id,
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, message: "打刻に失敗しました" }, { status: 500 });
    }

    await logAudit(req, "staff_clock", { type, prev_state: state.kind }, {
      actorType: "staff", actorId: user.userId, companyId: profile.company_id,
    });

    return NextResponse.json({ ok: true, attendanceId: data.id });
  } catch (e) {
    return errorResponse(e);
  }
}
