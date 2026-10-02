import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { resolveSessionState, canPunch, PunchType } from "@/lib/attendance-session";
import { isCompanyBlocked } from "@/lib/tenant-context";

// セッション判定に必要な直近の打刻だけを見る（夜勤の日跨ぎに対応するためカレンダー日では区切らない）。
const LOOKBACK_HOURS = 72;
// 同じ種類の打刻がこの秒数以内に重なったら二重送信とみなして拒否する。
const DUPLICATE_WINDOW_SECONDS = 5;

// PostgREST が「その名前の関数が無い」と返すときのコード（42883 は Postgres 本体のコード）。
function isMissingFunction(e: { code?: string }): boolean {
  return e.code === "PGRST202" || e.code === "42883";
}

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

    if (await isCompanyBlocked(profile.company_id)) {
      return NextResponse.json({ ok: false, message: "このアカウントはご利用いただけません" }, { status: 403 });
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

    // 同時に2回送られても二重登録されないよう、DB側でスタッフ単位に直列化して登録する（0011）。
    // 直近 DUPLICATE_WINDOW_SECONDS 秒以内に同種の打刻があれば null が返る。
    const { data: punchId, error: rpcError } = await supabase.rpc("punch_attendance_once", {
      p_user_id: user.userId,
      p_user_name: user.displayName,
      p_company_id: profile.company_id,
      p_type: type,
      p_window_seconds: DUPLICATE_WINDOW_SECONDS,
    });

    let attendanceId: string | null = punchId ?? null;
    if (rpcError) {
      // マイグレーション(0011)の適用前にデプロイされた場合は従来の登録に戻す。
      // 関数が無いとき以外のエラーは握りつぶさない。
      if (!isMissingFunction(rpcError)) {
        return NextResponse.json({ ok: false, message: "打刻に失敗しました" }, { status: 500 });
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
      attendanceId = data.id;
    } else if (!attendanceId) {
      return NextResponse.json(
        { ok: false, message: "すでに打刻されています。画面を更新して確認してください" },
        { status: 409 },
      );
    }

    await logAudit(req, "staff_clock", { type, prev_state: state.kind }, {
      actorType: "staff", actorId: user.userId, companyId: profile.company_id,
    });

    return NextResponse.json({ ok: true, attendanceId });
  } catch (e) {
    return errorResponse(e);
  }
}
