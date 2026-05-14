import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const user = await getLineUserCached(req);
  if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

  let score: number;
  let comment: string | null;
  try {
    const body = await req.json();
    score = Number(body.score);
    comment = typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 200) : null;
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ ok: false, message: "scoreは1〜5で指定" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, message: "不正なリクエスト" }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("condition_reports")
    .insert({
      user_id: user.userId,
      score,
      comment,
      reported_at: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ ok: false, message: "送信に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
