// 案A(限定カギ方式)：company_idクレーム付きの署名済みJWTで、RLSがcompany_idを
// 検証してくれるスコープ付きクライアントを返す。service_role(getSupabaseAdmin)の代わりに、
// 「他社データへのアクセスをDB側(RLS)が物理的にブロックする」保険を必要とする読み書きで使う。
//
// 既存のアプリ層チェック(tenant-context.ts / scripts/tenant_isolation_test.ts)を置き換える
// ものではない。あくまで二重の保険。呼び出し側は引き続きcompany_idで絞ること。
//
// 通信経路(PostgREST/HTTP)は service_role の時と同じ。Vercel⇔Postgresの直接接続には
// 変更しない(接続数枯渇・Supavisorのtransaction-mode下でのセッション変数運用の難度を理由に見送り。
// 詳細はarchitecture_state.md参照)。
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { mintTenantAccessToken } from "./tenant-jwt";

let _url: string | null = null;
let _anonKey: string | null = null;

function readEnv(): { url: string; anonKey: string } {
  if (_url && _anonKey) return { url: _url, anonKey: _anonKey };
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!rawUrl || !rawAnon) {
    throw new Error("SUPABASE env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  }
  _url = rawUrl.trim().replace(/^["']|["']$/g, "");
  _anonKey = rawAnon.trim().replace(/^["']|["']$/g, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(_url)) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL format is invalid. Got: "${_url}"`);
  }
  return { url: _url, anonKey: _anonKey };
}

// 毎回新しいクライアントを作る(トークンのTTLが60秒と短いため使い回さない)。
// 1リクエスト内で複数回呼んでも実害は無いが、多用する場合は呼び出し元でキャッシュしてよい。
export function getScopedSupabaseClient(companyId: string): SupabaseClient {
  if (!companyId) throw new Error("getScopedSupabaseClient: companyId required");
  const { url, anonKey } = readEnv();
  const token = mintTenantAccessToken(companyId);
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
