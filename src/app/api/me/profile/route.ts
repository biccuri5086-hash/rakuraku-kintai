import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, full_name, phone, role, company_id")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error) throw new Error(`supabase: ${error.message}`);

    if (!profile) {
      return NextResponse.json({ ok: true, profile: null });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("name, status")
      .eq("id", profile.company_id)
      .maybeSingle();

    const { data: settings } = await supabase
      .from("tenant_settings")
      .select("feature_condition, feature_gps, comment_required")
      .eq("company_id", profile.company_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      profile,
      company,
      settings,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
