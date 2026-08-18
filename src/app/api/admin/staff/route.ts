import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// スタッフ一覧（契約フォームの選択肢・管理台帳の属性編集などに使う軽量エンドポイント）
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, full_name, employment_type, social_insurance")
      .eq("company_id", ctx.companyId)
      .order("display_name", { ascending: true });
    if (error) throw error;

    const staff = (data ?? []).map((p) => ({
      user_id: p.user_id,
      name: p.full_name || p.display_name || p.user_id,
      employment_type: (p as { employment_type?: string | null }).employment_type ?? null,
      social_insurance: (p as { social_insurance?: string | null }).social_insurance ?? null,
    }));
    return NextResponse.json({ ok: true, staff });
  } catch (e) {
    return errorResponse(e);
  }
}

// スタッフの派遣法・台帳属性（無期/有期・社会保険加入状況）を更新
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const user_id = String(body?.user_id ?? "").trim();
    if (!user_id) return NextResponse.json({ ok: false, message: "user_idが必要です" }, { status: 400 });

    const et = body?.employment_type;
    const si = body?.social_insurance;
    const employment_type = et === "indefinite" || et === "fixed" ? et : null;
    const social_insurance =
      si === "enrolled" || si === "not_enrolled" || si === "exempt" ? si : null;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("user_profiles")
      .update({ employment_type, social_insurance })
      .eq("company_id", ctx.companyId)
      .eq("user_id", user_id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
