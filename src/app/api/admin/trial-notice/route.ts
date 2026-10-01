import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getScopedSupabaseClient } from "@/lib/supabase-tenant";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit-log";
import { errorResponse } from "@/lib/api-handler";
import { trialNotice, isTrialDecision } from "@/lib/billing/trial-notice";

// トライアル終了7日前からの「続ける／やめる」選択。
// GET: 表示すべき通知の状態。POST: 選択を保存。company_id は常にセッション由来。

export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const supabase = getScopedSupabaseClient(ctx.companyId);

    const [{ data: company }, { data: sub }] = await Promise.all([
      supabase.from("companies").select("*").eq("id", ctx.companyId).maybeSingle(),
      supabase.from("company_subscription").select("plan, status").eq("company_id", ctx.companyId).maybeSingle(),
    ]);
    if (!company) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const paidPlanActive = sub?.status === "active";
    return NextResponse.json({
      ok: true,
      notice: trialNotice(company.status, company.trial_ends_at, company.trial_decision, paidPlanActive),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isTrialDecision(body.decision)) {
      return NextResponse.json({ ok: false, message: "選択が不正です" }, { status: 400 });
    }

    // トライアル中の会社だけが対象（それ以外の status を書き換えさせない）
    const { data, error } = await getSupabaseAdmin()
      .from("companies")
      .update({ trial_decision: body.decision, trial_decision_at: new Date().toISOString() })
      .eq("id", ctx.companyId)
      .eq("status", "trial")
      .select("id");
    if (error) {
      return NextResponse.json(
        { ok: false, message: "保存できませんでした。時間をおいて再度お試しください。", detail: error.message },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ ok: false, message: "トライアル中ではありません" }, { status: 409 });
    }

    await logAudit(req, "admin_trial_decision", { decision: body.decision }, {
      actorType: "admin", actorId: ctx.adminId, companyId: ctx.companyId,
    });
    return NextResponse.json({ ok: true, decision: body.decision });
  } catch (e) {
    return errorResponse(e);
  }
}
