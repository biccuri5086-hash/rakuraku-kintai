import { NextRequest, NextResponse } from "next/server";
import { getLineSessionCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function POST(req: NextRequest) {
  try {
  const session = await getLineSessionCached(req);
  if (!session) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
  const { user, companyId } = session;

  let attendanceId: string;
  let lat: number;
  let lng: number;
  let accuracy: number;
  try {
    const body = await req.json();
    attendanceId = String(body.attendanceId ?? "");
    lat = Number(body.lat);
    lng = Number(body.lng);
    accuracy = Number(body.accuracy);
    if (!attendanceId || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) {
      return NextResponse.json({ ok: false, message: "パラメータが不正" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
  }

  if (!companyId) {
    return NextResponse.json({ ok: false, message: "プロフィール未登録" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("attendance")
    .update({ lat, lng, gps_accuracy: accuracy })
    .eq("id", attendanceId)
    .eq("user_id", user.userId)
    .eq("company_id", companyId);

  if (error) {
    return NextResponse.json({ ok: false, message: "GPS更新に失敗" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
