import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { logAudit } from "@/lib/audit-log";
import { isCompanyBlocked } from "@/lib/tenant-context";

export async function POST(req: NextRequest) {
  try {
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

    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("company_id")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (!profile?.company_id) {
      return NextResponse.json({ ok: false, message: "プロフィール未登録です" }, { status: 400 });
    }

    if (await isCompanyBlocked(profile.company_id)) {
      return NextResponse.json({ ok: false, message: "このアカウントはご利用いただけません" }, { status: 403 });
    }

    const { data: settings } = await supabase
      .from("tenant_settings")
      .select("feature_condition")
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (settings && !settings.feature_condition) {
      return NextResponse.json({ ok: false, message: "コンディション報告機能はこの会社では無効です" }, { status: 403 });
    }

    const { error } = await supabase
      .from("condition_reports")
      .insert({
        user_id: user.userId,
        score,
        comment,
        reported_at: new Date().toISOString(),
        company_id: profile.company_id,
      });

    if (error) {
      return NextResponse.json({ ok: false, message: "送信に失敗しました" }, { status: 500 });
    }

    await logAudit(req, "staff_condition", { score }, {
      actorType: "staff", actorId: user.userId, companyId: profile.company_id,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
