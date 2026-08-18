# ラクラク勤怠 運用手順書（RUNBOOK）

最終更新: 2026-08-19 ／ 対象: 運営者（小原健太）。障害時にまずこのファイルを開く。

---

## 0. 構成の全体像
| 層 | サービス | 役割 |
|---|---|---|
| アプリ | Vercel（main から自動デプロイ） | Next.js 本体。URL: https://rakuraku-kintai.vercel.app |
| DB/認証 | Supabase（Postgres） | データ・RLS(service_role運用)・Auth |
| 監視 | Sentry | 例外・エラーの収集 |
| CI | GitHub Actions | lint/型/テスト/build＋DB自動マイグレーション |
| 死活監視 | `/api/health`（外形監視から叩く） | アプリ＋DB到達性 |

---

## 1. 死活監視（外形監視の設定）
- ヘルスURL: `https://rakuraku-kintai.vercel.app/api/health`
  - 正常時 `200 {"ok":true,"db":"up",...}` / DB不通時 `503 {"db":"down"}`。
- **やること（運営者・1回）**: UptimeRobot 等の無料外形監視に上記URLを登録（5分間隔・キーワード `"db":"up"`）。ダウン時にメール/LINE通知。
- Sentry: 例外は自動収集。**Sentry側でアラート通知**（新規Issue/急増）をメールに飛ばす設定を有効化しておく。
- Vercel/Supabase: プロジェクト設定で障害通知メールをオンにする。

## 2. バックアップ
- **Supabase 自動バックアップ**: 有料プランは日次自動（Point-in-Time Recovery はプランに依存）。**現行プランのバックアップ範囲をSupabaseダッシュボードで必ず確認**する。
- **手動バックアップ（重要変更の前に推奨）**:
  - Supabase → Database → Backups から手動バックアップ、または
  - `pg_dump`（接続文字列は Connect → Session pooler）でローカルにダンプを取得。
- **マイグレーション前**は必ずバックアップ（rules.md Rule 1 準拠）。additive設計だが保険。

## 3. リストア（復旧）
1. 影響範囲を確認（全社 or 単一テナントか）。
2. Supabase の Backups から復元点を選択して復元、または pg_dump のダンプを `psql` で流し込む。
3. 復元後、`/api/health` が `db:up`、主要画面（/admin, /admin/payroll, /admin/compliance）が開くことを確認。
4. `npm run dogfood` で1社分の通し（給与/台帳/抵触日）を実行し、集計が正しいことを確認。

## 4. マイグレーションの運用とロールバック
- **適用**: `db/migrations/` に `NNNN_*.sql`（冪等）を追加し main にマージ → GitHub Actions「DB Migrate」が自動適用（`schema_migrations` で適用済み管理）。手動は Actions → Run workflow。
- **確認**: Actions の DB Migrate が緑。失敗時はログの `✗` 行を確認（接続文字列は Session pooler(IPv4) 必須）。
- **ロールバック**: マイグレーションは基本 additive（`create ... if not exists`）。切り戻す場合は追加した表/列を `drop` する逆SQLを新しい番号で追加して適用。**データ削除を伴う場合は事前バックアップ必須**。

## 5. よくある障害と対処
| 症状 | 主な原因 | 対処 |
|---|---|---|
| 画面が 500 / "SUPABASE env missing" | Vercel 環境変数の欠落・別プロジェクト | Vercel の Environment Variables を確認 → Redeploy |
| ログイン弾かれる | パスワード誤り/レート制限 | `/admin/password`・`/superadmin/password` で再設定。15分待つ。rate_limits を確認 |
| 新機能の画面が「準備中/未適用」 | マイグレーション未適用 | Actions → DB Migrate を実行（`npm run migrate` でも可） |
| DB Migrate が exit 1 | Direct(IPv6) 接続文字列 | Secret `DATABASE_URL` を Session pooler(IPv4) に差し替え |
| 集計値がおかしい | ロジック/データ不整合 | `npm run dogfood` と `npm test` で切り分け。打刻漏れは要確認で除外される仕様 |

## 6. 秘密情報のローテーション
- **DBパスワード**: Supabase → Database → Reset database password → GitHub Secret `DATABASE_URL` を更新（アプリは service_role 接続なので本番影響なし）。
- **service_role / anon key**: Supabase で再発行 → Vercel 環境変数を更新 → Redeploy。
- **SESSION_SECRET / PHONE_* 鍵**: 変更すると既存セッション無効化・暗号化データ復号不可になり得るため**原則変更しない**。必要時は移行手順を別途設計。

## 7. ステージング（推奨・未整備）
- 現状 main → 本番直行。**推奨**: Vercel の Preview（PRごとの自動プレビュー）を検証環境として使う。DBは本番共有を避け、別 Supabase プロジェクトを Preview 用環境変数に割り当てるのが理想（着手候補）。

## 8. リリース前チェックリスト
- [ ] `npm run typecheck` / `npm test` が緑
- [ ] `npm run build` 成功
- [ ] DB変更があれば `db/migrations/` に冪等SQLを追加（バックアップ取得済み）
- [ ] 重要変更はハヤト/ノアのダブルチェック＋オーナー承認（rules.md Rule 1）
- [ ] デプロイ後 `/api/health` が `db:up`、主要画面が開くことを確認
