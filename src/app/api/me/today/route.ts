import { NextRequest, NextResponse } from "next/server";
import { requireLineUser } from "@/lib/line-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const user = await requireLineUser(req);
  if (!user) return NextResponse.json({ ok: false, message: "未認証" }, { status: 401 });

  const today = new Date().toISOString().split("T")[0];
  const { data } = await getSupabaseAdmin()
    .from("attendance")
    .select("type, timestamp")
    .eq("user_id", user.userId)
    .gte("timestamp", `${today}T00:00:00`)
    .order("timestamp", { ascending: true });

  const records = (data ?? []) as { type: string; timestamp: string }[];
  const clockIn = records.find((r) => r.type === "clock_in")?.timestamp ?? null;
  const clockOut = records.find((r) => r.type === "clock_out")?.timestamp ?? null;

  return NextResponse.json({ ok: true, clockIn, clockOut });
}
