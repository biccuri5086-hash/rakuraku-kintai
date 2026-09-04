import { NextRequest, NextResponse, after } from "next/server";
import { getLineSessionCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { resolveSessionState, canPunch, PunchType } from "@/lib/attendance-session";

// セッション判定に必要な直近の打刻だけを見る（夜勤の日跨ぎに対応するためカレンダー日では区切らない）。
const LOOKBACK_HOURS = 72;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const session = await getLineSessionCached(req);
    if (!session) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const { user, companyId } = session;

    let type: PunchType;
    let idempotencyKey: string;
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy: number | null = null;
    try {
      const body = await req.json();
      if (body.type !== "clock_in" && body.type !== "clock_out") {
        return NextResponse.json({ ok: false, message: "type が不正です" }, { status: 400 });
      }
      type = body.type;

      // 冪等キー：LIFF側でボタン押下時に1回だけ採番し、再送・連打でも同じ値を送らせる。
      // 通信リトライで同じキーが来た場合は既存の打刻をそのまま成功として返す（二重打刻防止）。
      if (typeof body.idempotencyKey !== "string" || !UUID_RE.test(body.idempotencyKey)) {
        return NextResponse.json({ ok: false, message: "idempotencyKey が不正です" }, { status: 400 });
      }
      idempotencyKey = body.idempotencyKey;

      if (body.lat !== undefined) {
        const l = Number(body.lat), g = Number(body.lng), a = Number(body.accuracy);
        if (Number.isFinite(l) && Number.isFinite(g) && Number.isFinite(a)) {
          lat = l; lng = g; accuracy = a;
        }
      }
    } catch {
      return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!companyId) {
      return NextResponse.json({ ok: false, message: "プロフィール未登録です。先にスタッフ登録を済ませてください。" }, { status: 400 });
    }

    const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
    const { data: recent } = await supabase
      .from("attendance")
      .select("type, timestamp")
      .eq("user_id", user.userId)
      .eq("company_id", companyId)
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
        company_id: companyId,
        idempotency_key: idempotencyKey,
        lat, lng, gps_accuracy: accuracy,
      })
      .select("id")
      .single();

    if (error) {
      // 冪等キーの重複＝同じ打刻の再送。エラーにせず、元の打刻IDを成功として返す。
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("attendance")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ ok: true, attendanceId: existing.id, duplicate: true });
        }
      }
      return NextResponse.json({ ok: false, message: "打刻に失敗しました" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, message: "打刻に失敗しました" }, { status: 500 });
    }

    // 監査ログはレスポンスを遅らせない（打刻本体の成否には影響しないため after() で後追い実行）。
    after(() =>
      logAudit(req, "staff_clock", { type, prev_state: state.kind }, {
        actorType: "staff", actorId: user.userId, companyId,
      })
    );

    return NextResponse.json({ ok: true, attendanceId: data.id });
  } catch (e) {
    return errorResponse(e);
  }
}
