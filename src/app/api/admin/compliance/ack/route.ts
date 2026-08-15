import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// Phase C: 抵触日アラートの確認・対応記録。compliance_acks に保存。
// テーブルは PHASE_C_MIGRATION.sql 適用後に存在するため、未適用時は 409（未適用）を返す。
// テナント境界：companyId はセッションから導出。

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = body.scope;
    if (scope !== "office" && scope !== "individual") {
      return NextResponse.json({ ok: false, message: "scope 不正" }, { status: 400 });
    }
    const str = (v: unknown) => (typeof v === "string" && v.length ? v : null);

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("compliance_acks").insert({
      company_id: ctx.companyId,
      scope,
      client_id: str(body.client_id),
      user_id: str(body.user_id),
      org_unit: str(body.org_unit),
      limit_date: str(body.limit_date),
      note: str(body.note),
      acknowledged_by: ctx.adminId,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, message: "記録できませんでした。派遣法テーブル（PHASE_C_MIGRATION.sql）の適用が必要です。", detail: error.message },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
