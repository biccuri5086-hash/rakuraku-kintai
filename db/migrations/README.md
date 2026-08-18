# db/migrations — 自動マイグレーション

`scripts/migrate.mjs`（= `npm run migrate`）がこのフォルダの `*.sql` を**ファイル名順**に適用し、
DB内の `schema_migrations` テーブルに適用済みを記録します。適用済みはスキップするので何度実行しても安全です。

## ルール
- ファイル名は `NNNN_説明.sql`（ゼロ埋め連番）。番号順に適用される。
- 各SQLは**冪等**に書く（`create table if not exists` / `add column if not exists` 等）。
- 新しい変更は、このフォルダに次の番号でSQLを追加する。specs/ 配下の設計書とセットで。

## 実行方法
```bash
# ローカル（接続文字列は環境変数でのみ渡す。ファイルに保存しない）
DATABASE_URL="postgresql://..." npm run migrate
DATABASE_URL="postgresql://..." npm run migrate -- --dry   # 適用予定の確認のみ
```
CI（GitHub Actions）では `.github/workflows/migrate.yml` が Secret `DATABASE_URL` を使って自動実行します。

## 履歴の注記
- 0001〜0003（Phase B/C/D）が、この自動パイプラインの最初の対象。
- これ以前（マルチテナント基盤・Phase A 派遣モデル・superadmin seed 等）は自動化以前に
  Supabase の SQL Editor で手動適用済み。原本は `らくらく勤怠/specs/` にある。
