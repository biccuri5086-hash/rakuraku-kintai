import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// 死活監視用のヘルスチェック（認証不要・データを返さない）。
// UptimeRobot 等の外形監視から叩く。DB到達性も軽く確認する。
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let db: "up" | "down" = "down";
  try {
    const supabase = getSupabaseAdmin();
    // 最軽量の到達確認（件数だけ・行データは取らない）
    const { error } = await supabase.from("companies").select("id", { count: "exact", head: true });
    db = error ? "down" : "up";
  } catch {
    db = "down";
  }

  const body = {
    ok: db === "up",
    db,
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: db === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
