import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";
import { loadFullSettings, validateFull, fullToRow } from "@/lib/payroll/companySettings";

// 会社ごとの給与集計設定。
// GET: 現在の設定（company_payroll_settings 未適用ならデフォルト）。適用前でもエラーにならない。
// PUT: 設定を保存（upsert）。company_payroll_settings 適用後に有効（未適用ならDBエラーを返す）。
// テナント境界：companyId はセッションから導出。

export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });
    const supabase = getSupabaseAdmin();
    const { settings, source } = await loadFullSettings(supabase, ctx.companyId);
    return NextResponse.json({ ok: true, settings, source });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const v = validateFull(body);
    if (!v.ok) return NextResponse.json({ ok: false, message: v.error }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const row = fullToRow(ctx.companyId, v.value);
    const { error } = await supabase.from("company_payroll_settings").upsert(row, { onConflict: "company_id" });
    if (error) {
      // テーブル未適用（PHASE_B_MIGRATION.sql 未実行）の典型
      return NextResponse.json(
        { ok: false, message: "設定を保存できませんでした。給与テーブル（PHASE_B_MIGRATION.sql）の適用が必要です。", detail: error.message },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, settings: v.value, source: "db" });
  } catch (e) {
    return errorResponse(e);
  }
}
