import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

// 検証用スキーマ切り替え（ステージング用）。
// Supabase の無料プロジェクト数上限に達したため、本番と同じプロジェクト・同じ接続情報の
// まま、Postgres スキーマだけを分けて検証環境を作れるようにする（db/migrations/README 参照）。
// 【安全装置】未設定なら必ず "public"（＝本番と同じ挙動）。本番の Vercel 環境変数には
// SUPABASE_SCHEMA を絶対に設定しないこと（誤って設定すると本番が空のstagingスキーマを
// 見に行き、スタッフが打刻できない・管理画面が空に見える、という重大インシデントになる）。
const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

function resolveSchema(): string {
  const raw = (process.env.SUPABASE_SCHEMA ?? "public").trim();
  if (!raw) return "public";
  if (!SCHEMA_RE.test(raw)) {
    throw new Error(`SUPABASE_SCHEMA format is invalid: "${raw}"`);
  }
  return raw;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !rawKey) {
    throw new Error("SUPABASE env vars missing");
  }
  const url = rawUrl.trim().replace(/^["']|["']$/g, "");
  const key = rawKey.trim().replace(/^["']|["']$/g, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL format is invalid. Got: "${url}" (length=${url.length}). Expected: https://xxxx.supabase.co`
    );
  }
  if (key.length < 20) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY looks too short (length=${key.length})`);
  }
  const schema = resolveSchema();
  // schema はランタイムの環境変数由来の string なので "public" というリテラル型に
  // 絞り込めない。createClient の戻り値をそのまま代入すると SchemaName ジェネリクスの
  // 不一致で型エラーになるため、ここだけ SupabaseClient（既定=public型）にアサーションする。
  // 実行時の挙動は schema 変数の値どおりに決まり、この型注釈はコンパイル時の表現に過ぎない。
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
  }) as SupabaseClient;
  return _client;
}
