import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    let type: "clock_in" | "clock_out";
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

    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabase
      .from("attendance")
      .select("id, type")
      .eq("user_id", user.userId)
      .eq("company_id", profile.company_id)
      .gte("timestamp", `${today}T00:00:00`)
      .order("timestamp", { ascending: false });

    const todayRecords = (existing ?? []) as { id: string; type: string }[];
    if (type === "clock_in" && todayRecords.some((r) => r.type === "clock_in")) {
      return NextResponse.json({ ok: false, message: "本日はすでに出勤打刻済みです" }, { status: 409 });
    }
    if (type === "clock_out" && !todayRecords.some((r) => r.type === "clock_in")) {
      return NextResponse.json({ ok: false, message: "出勤打刻が見つかりません" }, { status: 409 });
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

    await logAudit(req, "staff_clock", { type }, {
      actorType: "staff", actorId: user.userId, companyId: profile.company_id,
    });

    return NextResponse.json({ ok: true, attendanceId: data.id });
  } catch (e) {
    return errorResponse(e);
  }
}
