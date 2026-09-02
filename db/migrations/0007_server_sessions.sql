-- ============================================================
-- 0007: サーバ側セッション表（失効可能な継続ログイン / 案C）
-- ============================================================
-- 署名Cookie(stateless)から、DBで状態を持つセッションへ移行する。
-- - 個別/一括で失効可能（パスワード・2FA変更時に他端末を自動ログアウト）
-- - スライディング期限＋絶対上限
-- - CookieにはランダムなシークレットのみでDBはそのSHA-256ハッシュを保存
-- 空DB・再実行に安全（if not exists ガード）。
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists auth_sessions (
  id                  uuid primary key default gen_random_uuid(),
  actor_type          text not null check (actor_type in ('admin', 'super_admin')),
  actor_id            text not null,
  company_id          uuid,                      -- admin のみ。super_admin は null
  token_hash          text not null,             -- Cookie内シークレットの SHA-256（16進）
  idle_ttl_seconds    integer not null,          -- スライド時に先送りする窓の長さ
  idle_expires_at     timestamptz not null,      -- この時刻を過ぎたら失効（使うたび先送り）
  absolute_expires_at timestamptz not null,      -- 放置でも必ず失効する上限
  last_used_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz,               -- 失効時刻（null＝有効）
  user_agent          text,
  ip                  text
);

create index if not exists idx_auth_sessions_actor on auth_sessions (actor_type, actor_id);
create index if not exists idx_auth_sessions_sweep on auth_sessions (absolute_expires_at);

-- RLSは他テーブルと同様「有効・ポリシー0件」（service_role のみ通す）。
alter table auth_sessions enable row level security;
