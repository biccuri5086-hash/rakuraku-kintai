import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// 死活監視用のヘルスチェック（認証不要・データを返さない）。
// UptimeRobot 等の外形監視から叩く。DB到達性も軽く確認する。
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let db: "up" | "down" = "down";
  let debugError: string | null = null;
  try {
    const supabase = getSupabaseAdmin();
    // 最軽量の到達確認（件数だけ・行データは取らない）
    const { error } = await supabase.from("companies").select("id", { count: "exact", head: true });
    db = error ? "down" : "up";
    if (error) {
      debugError = `${error.code ?? ""} ${error.message ?? ""}`.trim();
      console.error("[health] db check failed:", error);
    }
  } catch (e) {
    db = "down";
    debugError = e instanceof Error ? e.message : String(e);
    console.error("[health] db check threw:", e);
  }

  // 接続先の識別（秘密ではない：Supabaseプロジェクト参照＝公開URLの一部）。
  // Preview が staging を向いているかの切り分け用。
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const project = supaUrl.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? "unknown";

  const body = {
    ok: db === "up",
    db,
    env: process.env.VERCEL_ENV ?? "local", // production / preview / local
    project, // 接続先Supabaseプロジェクトの参照
    schema: process.env.SUPABASE_SCHEMA ?? "public", // ステージング検証用スキーマを見ているかの切り分け用
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
    // 本番(Vercel)ではエラー詳細を外部に出さない。ローカル検証時だけ切り分けのために含める。
    ...(process.env.VERCEL_ENV ? {} : { debugError }),
  };
  return NextResponse.json(body, {
    status: db === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
