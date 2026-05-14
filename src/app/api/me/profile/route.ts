import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const { data, error } = await getSupabaseAdmin()
      .from("user_profiles")
      .select("user_id, display_name, phone, role")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error) throw new Error(`supabase: ${error.message}`);

    return NextResponse.json({ ok: true, profile: data ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
