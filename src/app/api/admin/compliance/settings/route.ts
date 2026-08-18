import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// Phase C：会社単位の管理台帳(法37条)記載事項。派遣元責任者・苦情申出先・待遇決定方式。
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("compliance_settings")
      .select("agency_manager, complaint_contact, wage_method")
      .eq("company_id", ctx.companyId)
      .maybeSingle();

    // テーブル未適用（マイグレーション反映前）でも画面を壊さない
    if (error) return NextResponse.json({ ok: true, ready: false, settings: null });
    return NextResponse.json({ ok: true, ready: true, settings: data ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clean = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s.length > 0 ? s : null;
    };
    const wm = body?.wage_method;
    const wage_method = wm === "roushi" || wm === "kinto" ? wm : null;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("compliance_settings").upsert(
      {
        company_id: ctx.companyId,
        agency_manager: clean(body?.agency_manager),
        complaint_contact: clean(body?.complaint_contact),
        wage_method,
      },
      { onConflict: "company_id" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
