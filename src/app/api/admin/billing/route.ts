import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { PLANS, DEFAULT_SUBSCRIPTION, rowToSubscription, estimateMonthly, isPlanId, statusForPlan } from "@/lib/billing/plans";

// Phase D: 課金（プラン管理）。
// GET: 現在の契約プラン（company_subscription 未適用なら トライアル既定）＋登録スタッフ数＋概算。適用前でも動く。
// PUT: プラン変更（company_subscription にupsert）。テーブル未適用時は 409（未適用）。
// テナント境界：companyId はセッションから導出。

export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const supabase = getSupabaseAdmin();

    let subscription = DEFAULT_SUBSCRIPTION;
    let source: "db" | "default" = "default";
    try {
      const { data, error } = await supabase.from("company_subscription").select("*").eq("company_id", ctx.companyId).maybeSingle();
      if (!error && data) {
        subscription = rowToSubscription(data as Record<string, unknown>);
        source = "db";
      }
    } catch {
      /* 未適用時はデフォルト */
    }

    const { count } = await supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("company_id", ctx.companyId);
    const staffCount = count ?? 0;

    const plans = PLANS.map((p) => ({ ...p, estimate: estimateMonthly(p.id, staffCount) }));
    return NextResponse.json({
      ok: true,
      source,
      subscription,
      staffCount,
      currentEstimate: estimateMonthly(subscription.plan, staffCount),
      plans,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isPlanId(body.plan)) return NextResponse.json({ ok: false, message: "plan 不正" }, { status: 400 });
    const plan = body.plan;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("company_subscription")
      .upsert({ company_id: ctx.companyId, plan, status: statusForPlan(plan) }, { onConflict: "company_id" });
    if (error) {
      return NextResponse.json(
        { ok: false, message: "プランを保存できませんでした。課金テーブル（PHASE_D_BILLING_MIGRATION.sql）の適用が必要です。", detail: error.message },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, plan, status: statusForPlan(plan) });
  } catch (e) {
    return errorResponse(e);
  }
}
