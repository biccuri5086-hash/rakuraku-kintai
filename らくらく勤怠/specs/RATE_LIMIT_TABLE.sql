-- ============================================================
-- rate_limits テーブル: ログイン試行のレート制限を永続化
-- ============================================================
-- Vercel serverless はインスタンスごとに別メモリのため、
-- 旧 in-memory 版ではブルートフォース対策として不完全だった。
-- このテーブルで「IP×用途」単位で試行回数を集計する。
--
-- 実行方法:
--   1. Supabase の SQL Editor で New query
--   2. このファイルを丸ごとコピペして Run
--
-- 冪等: 何度実行しても重複は作られない（IF NOT EXISTS / OR REPLACE）。
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);

-- RLS: service_role からのみアクセス可能（一般ユーザーは触らせない）
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーがあれば削除して作り直し（冪等性確保）
DROP POLICY IF EXISTS "service_role_only" ON rate_limits;
CREATE POLICY "service_role_only" ON rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 期限切れエントリの定期削除関数（Cron Job または手動で呼ぶ）
CREATE OR REPLACE FUNCTION purge_expired_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE reset_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE rate_limits IS 'ログイン等のレート制限カウンタ。key 形式: "admin:<ip>" / "superadmin:<ip>"';
