import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("company_id")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (!profile?.company_id) {
      return NextResponse.json({ ok: true, clockIn: null, clockOut: null });
    }

    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("attendance")
      .select("type, timestamp")
      .eq("user_id", user.userId)
      .eq("company_id", profile.company_id)
      .gte("timestamp", `${today}T00:00:00`)
      .order("timestamp", { ascending: true });

    if (error) throw new Error(`supabase: ${error.message}`);

    const records = (data ?? []) as { type: string; timestamp: string }[];
    const clockIn = records.find((r) => r.type === "clock_in")?.timestamp ?? null;
    const clockOut = records.find((r) => r.type === "clock_out")?.timestamp ?? null;

    return NextResponse.json({ ok: true, clockIn, clockOut });
  } catch (e) {
    return errorResponse(e);
  }
}
