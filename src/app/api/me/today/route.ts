import { NextRequest, NextResponse } from "next/server";
import { getLineUserCached } from "@/lib/me-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { errorResponse } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  try {
    const user = await getLineUserCached(req);
    if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await getSupabaseAdmin()
      .from("attendance")
      .select("type, timestamp")
      .eq("user_id", user.userId)
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
