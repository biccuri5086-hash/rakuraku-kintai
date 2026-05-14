import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const user = await getLineUserCached(req);
  if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

  const { data } = await getSupabaseAdmin()
    .from("user_profiles")
    .select("user_id, display_name, phone, role")
    .eq("user_id", user.userId)
    .maybeSingle();

  return NextResponse.json({ ok: true, profile: data ?? null });
}
