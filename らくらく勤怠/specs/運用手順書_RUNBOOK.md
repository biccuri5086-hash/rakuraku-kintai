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
- **外部ストレージへの日次自動退避（GitHub Actions「DB Backup」）**: `pg_dump` の論理バックアップを
  暗号化（age）した上で Cloudflare R2 に日次保存する。Supabase 側の障害・アカウント問題が起きても
  復元できるようにするための最終防衛線（設計：`らくらく勤怠/specs/ARCH_商用インフラ設計_v1.md` 2章）。
  - 必要な Secret: `DATABASE_URL`（Session pooler・IPv4）, `AGE_PUBLIC_KEY`, `R2_ENDPOINT`,
    `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`。いずれか未設定ならワークフローは
    notice を出してスキップする（失敗にはしない）。
  - `age` の**秘密鍵はGitHubに置かない**。1Password 等のオフライン保管庫でのみ管理する。
  - 保存先: `s3://<R2_BUCKET>/prod/YYYY/MM/DD/dump.custom.gz.age`。世代管理（日次7/週次5/月次12）は
    R2側のライフサイクルルールで設定する（未設定なら手動で定期削除）。
  - PITR（Point-in-Time Recovery）は未導入。導入する場合は Supabase Pro + PITRアドオンが必要
    （費用試算は同設計書 4章）。当面はこの日次バックアップのみで運用し、RPOは最大24時間として扱う。

## 3. リストア（復旧）
1. 影響範囲を確認（全社 or 単一テナントか）。
2. Supabase の Backups から復元点を選択して復元、または pg_dump のダンプを `psql` で流し込む。
   - R2に退避した暗号化ダンプを使う場合: `age --decrypt -i <秘密鍵ファイル> -o dump.custom.gz dump.custom.gz.age`
     → `gunzip dump.custom.gz` → `pg_restore --clean --no-owner -d <接続文字列> dump.custom`
   - **本番へ直接復元しない**。まず別プロジェクト（staging）に復元して検証してから切替を判断する。
3. 復元後、`/api/health` が `db:up`、主要画面（/admin, /admin/payroll, /admin/compliance）が開くことを確認。
4. `npm run dogfood` で1社分の通し（給与/台帳/抵触日）を実行し、集計が正しいことを確認。
5. **月1回、上記1〜4を実際に演習する**（リストアできないバックアップは無い物として扱う）。演習結果をこのRUNBOOKの変更履歴として残す。

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

## 5.5 スタッフの無効化・打刻停止

- `PATCH /api/admin/staff` に `{ user_id, status: "inactive" }` を送るとスタッフを無効化できる（UIは未整備・現状はAPI直叩きかSQL Editor）。
- **無効化してから打刻APIで実際に拒否されるまで、最大5分の遅延がある**。
  `src/lib/me-session.ts` が `company_id`／在籍状態(user_profiles.status)／
  会社状態(companies.status)を5分キャッシュしているため（打刻APIのDB往復を
  減らすためのキャッシュで、即時反映と引き換えにしている）。緊急停止したい場合は
  5分待つか、Supabase側で該当スタッフの `user_profiles.status` を直接
  `inactive` にした上で数分待つ。
- 会社の利用停止（`companies.status = 'suspended'/'cancelled'`）も同じ経路で
  打刻を止められる（同じ5分遅延）。

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
