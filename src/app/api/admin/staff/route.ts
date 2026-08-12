import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

// スタッフ一覧（契約フォームの選択肢などに使う軽量エンドポイント）
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, full_name")
      .eq("company_id", ctx.companyId)
      .order("display_name", { ascending: true });
    if (error) throw error;

    const staff = (data ?? []).map((p) => ({
      user_id: p.user_id,
      name: p.full_name || p.display_name || p.user_id,
    }));
    return NextResponse.json({ ok: true, staff });
  } catch (e) {
    return errorResponse(e);
  }
}
