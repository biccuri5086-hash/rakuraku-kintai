import { NextRequest, NextResponse, after } from "next/server";
import { getLineSessionCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { resolveSessionState, canPunch, PunchType } from "@/lib/attendance-session";
import { resolveClockInShift } from "@/lib/dispatch/resolveShift";
import { jstDateOf } from "@/lib/jst";

// セッション判定に必要な直近の打刻だけを見る（夜勤の日跨ぎに対応するためカレンダー日では区切らない）。
const LOOKBACK_HOURS = 72;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const session = await getLineSessionCached(req);
    if (!session) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const { user, companyId, blocked } = session;
    if (blocked === "staff_inactive") {
      return NextResponse.json({ ok: false, message: "アカウントが無効化されています。管理者にお問い合わせください。" }, { status: 403 });
    }
    if (blocked === "company_suspended") {
      return NextResponse.json({ ok: false, message: "この会社のサービスは現在ご利用いただけません。" }, { status: 403 });
    }

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
      .select("type, timestamp, assignment_id, client_id, shift_id, resolved_by")
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

    // 直行直帰対応：どの契約/派遣先の勤務かを解決する。
    // clock_out は直前の clock_in と同じ現場とみなす（セッション中に現場が変わることは無い前提）。
    // clock_in は当日/前日(夜勤対応)のシフトから解決し、黙って推測できないときは unresolved のまま記録する。
    let shiftId: string | null = null;
    let assignmentId: string | null = null;
    let clientId: string | null = null;
    let resolvedBy: "shift_match" | "manual" | "unresolved" | null = null;

    if (type === "clock_out") {
      const lastIn = (recent ?? []).find((p) => p.type === "clock_in");
      if (lastIn) {
        shiftId = (lastIn.shift_id as string | null) ?? null;
        assignmentId = (lastIn.assignment_id as string | null) ?? null;
        clientId = (lastIn.client_id as string | null) ?? null;
        resolvedBy = (lastIn.resolved_by as typeof resolvedBy) ?? null;
      }
    } else {
      const now = new Date().toISOString();
      const today = jstDateOf(now);
      const yesterday = jstDateOf(new Date(Date.now() - 24 * 3_600_000).toISOString());

      const { data: myAssignments } = await supabase
        .from("assignments")
        .select("id, client_id")
        .eq("company_id", companyId)
        .eq("user_id", user.userId)
        .eq("status", "active");

      const assignmentIds = (myAssignments ?? []).map((a) => a.id as string);
      let todaysShifts: { id: string; assignment_id: string; work_date: string }[] = [];
      if (assignmentIds.length) {
        const { data } = await supabase
          .from("shifts")
          .select("id, assignment_id, work_date")
          .in("assignment_id", assignmentIds)
          .in("work_date", [yesterday, today]);
        todaysShifts = (data ?? []) as typeof todaysShifts;
      }

      const resolution = resolveClockInShift(
        [yesterday, today],
        todaysShifts.map((s) => ({ id: s.id, assignmentId: s.assignment_id, workDate: s.work_date })),
        (myAssignments ?? []).map((a) => ({ id: a.id as string, clientId: (a.client_id as string | null) ?? null }))
      );
      shiftId = resolution.shiftId;
      assignmentId = resolution.assignmentId;
      clientId = resolution.clientId;
      resolvedBy = resolution.resolvedBy;
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
        shift_id: shiftId,
        assignment_id: assignmentId,
        client_id: clientId,
        resolved_by: resolvedBy,
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
