# RLS 限定カギ方式 — 設計・導入状況

最終更新: 2026-09-23（オーナー承認・カイ実装、着手回）

## 背景・目的

`architecture_state.md` の通り、これまでの唯一の防御は「各 `/api/admin/**` が
`company_id` でフィルタする」というアプリ層のチェックだけだった。DBアクセスは
全て `service_role`（RLSを常にバイパスする万能キー）経由のため、RLSポリシーを
どれだけ書いても機能していなかった（`0006_rls_hardening.sql` 参照）。

このタスクは「アプリのコードに `company_id` フィルタの書き忘れがあっても、
DB側（RLS）が物理的に他社データへのアクセスをブロックする」多層防御を追加する。
**サーバー完全乗っ取りへの対策ではなく、個別ルートのロジックバグに対する保険**。

## 採用方式（オーナー承認済み）

直接Postgres接続（`pg`等でVercel⇔Postgresを直結する方式）は採用しない。
理由：Vercelサーバーレスでの接続数枯渇リスク、Supavisorのtransaction-mode
pooling下での`SET LOCAL`運用の実装難度、既存のPostgREST
（`@supabase/supabase-js`）アーキテクチャからの逸脱が大きすぎるため。

代わりに、**既存のPostgREST/HTTP経由の接続方式は変えず**、`company_id`
クレームを含む署名付きJWTを管理者セッションごとに発行し、RLSがそのJWT
クレームを検証する方式（限定カギ方式）を採用した。Vercel側の接続アーキテクチャ
変更が不要になり、追加インフラコストもほぼゼロ（コンピュートのグレードアップ
不要）。

## 実装済みのもの

| 部品 | ファイル | 内容 |
|---|---|---|
| DB: 専用ロール + RLS | `db/migrations/0008_scoped_tenant_role.sql` | `app_tenant`ロール新設。`scripts/tenant_isolation_test.ts`のTENANT定数と同じ13テーブルに、`company_id = app_tenant_company_id()`のRLSポリシー |
| JWT発行・検証 | `src/lib/tenant-jwt.ts` | `role: app_tenant`, `company_id`クレーム付きHS256 JWT（TTL 60秒）。純粋関数、環境変数への依存は`mintTenantAccessToken`のみに隔離 |
| 鍵強度チェック | `src/lib/security-guard.ts` | `requireSupabaseJwtSecret`を追加（`SESSION_SECRET`と同じ強度基準、別鍵として管理） |
| スコープ付きクライアント | `src/lib/supabase-tenant.ts` | `getScopedSupabaseClient(companyId)`。`getSupabaseAdmin()`の代替 |
| selftest | `scripts/tenant_jwt_selftest.ts` | 署名検証・TTL・改ざん検知・鍵不一致を検証。`npm test`に登録済み |
| 適用済みルート | `src/app/api/admin/clients/route.ts` | GET/POST/PATCH/DELETE全て`getScopedSupabaseClient`に切り替え済み（最初の適用例） |

`npm test` / `npx eslint` / `npx tsc --noEmit` / `npm run build` は全て通過確認済み。

## 未実装・残作業

1. **`clients`以外の22本の`/api/admin/**`ルートが未移行**（引き続き`service_role`のまま）。
   `clients/route.ts`をテンプレートに、1本ずつ`getSupabaseAdmin()` → `getScopedSupabaseClient(ctx.companyId)`
   へ置き換えていく。`scripts/tenant_isolation_test.ts`のTENANT定数に無いテーブル
   （`admins` / `companies` / `compliance_settings` / `paid_leave_grants` / `paid_leave_takings`）
   はこの方式の対象外。対象に含める場合は0008マイグレーションのテーブル一覧と
   `tenant_isolation_test.ts`の両方を更新すること。
2. **`/api/superadmin/**`・`pg_cron`バッチは対象外のまま**（設計上、全社横断アクセスが
   必要なため。`service_role`を使い続ける）。

## ⚠ 本番投入前に必須の確認事項（この実装は本番Supabaseで未検証）

この変更は、この開発環境に本番Supabaseへの接続情報が無いため、**実際のSupabase
プロジェクトに対して一度も動作確認できていない**。以下を必ずステージング等で
確認してから本番反映すること。

### 1. 新しい環境変数が必要
- `SUPABASE_JWT_SECRET`：Supabaseダッシュボード → Project Settings → API →
  「JWT Secret」からコピー（`SUPABASE_SERVICE_ROLE_KEY`とは別物）。32文字以上。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：同ダッシュボードの「anon / public」キー。
  今まで一度も使っていなかったキー（このアプリはクライアント側でSupabaseに
  直接触れたことが無いため）。
- Vercelの環境変数に追加すること。

### 2. PostgREST側の動作確認
- `authenticator`ロールが`app_tenant`を継承できているか（マイグレーション内の
  確認クエリ参照）。
- `role: "app_tenant"`クレーム入りのJWTを`Authorization: Bearer`で渡した時、
  実際に`app_tenant`ロールとしてクエリが実行され、他社行が0件で返ることを
  実データで確認する（できれば2社分のテストデータで相互に見えないことを検証）。
- JWTの`exp`切れ・不正な`company_id`・鍵不一致のケースで、期待通りエラーになるか。

### 3. ロールバック手順
問題が起きた場合、`clients/route.ts`の`getScopedSupabaseClient`を
`getSupabaseAdmin`に戻せば即座に元の動作に戻る（RLSポリシー自体は
`service_role`に影響しないため、マイグレーションを戻す必要は無い）。

## セキュリティー監査（実施済み）

### ハヤト（security-auditor）：条件付き承認
- JWT署名・検証、RLSのNULL company_id扱い、UUID PK起因のシーケンス権限問題、
  本番エラーメッセージの情報漏洩、anon/authenticated権限の無変更 — いずれも問題なし。
- **[Medium・未対応]** `paid_leave_grants` / `paid_leave_takings` / `compliance_settings` は
  実際に`company_id`でスコープされたadmin APIが触っているにもかかわらず、
  `scripts/tenant_isolation_test.ts`のTENANT定数にも0008マイグレーションにも
  含まれていない（静的検査・RLS両方の抜け穴。この方式導入前からの既存の穴）。
- **[Medium・未対応]** `admins`（password_hash・totp_secret保持）・`companies`は
  今回の対象外。今回の変更による後退ではないが、最も機微な情報を持つテーブルが
  依然として多層防御の外にある。

### ノア（security-guardian）：条件付き承認（要フォロー）
- **[対応済み]** `admin_audit_log`へのapp_tenant権限が当初CRUD全部だったのを、
  SELECT/INSERTのみ（UPDATE/DELETE無し）に絞った。監査ログの改ざん・証跡削除を、
  管理者向けAPIのバグ経由でも起こせないようにするため（0008マイグレーション修正済み）。
- **正当性**：オーナーの明示的な承認あり（コスト・リスク・限界を説明した上での承認）。
- **⚠ 重要な運用上の注意（マージ＝即本番反映）**：このリポジトリの規約上、
  `db/migrations/*.sql`が`main`にマージされると、GitHub Actions「DB Migrate」が
  **自動的に本番Supabaseへ適用**する。つまりこのブランチをmainにマージする行為自体が、
  「本番未検証のRLS変更を本番DBに適用する」特権操作に等しい。
  **オーナーは、マージ前に必ず以下を終えること**：
  1. ステージング等での実地検証（本ドキュメント「本番投入前に必須の確認事項」参照）
  2. `SUPABASE_JWT_SECRET` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` をVercelに設定
  3. 上記が終わるまでは、このブランチをmainにマージしない
- `company_subscription`へのDELETE権限が実際に必要か（プラン変更は通常UPDATEで足りる
  はず）は未確認。次の見直しで対象にすること。

## 未着手のフォローアップ（優先度順）
1. `paid_leave_grants` / `paid_leave_takings` / `compliance_settings`をRLS対象に追加
   （`tenant_isolation_test.ts`のTENANT定数も同時に更新）
2. `admins` / `companies`へのRLS拡張を検討（company_idの持ち方が他と違うため別設計が必要）
3. `company_subscription`のDELETE権限が本当に必要か確認し、不要なら剥奪
4. `clients`以外の22ルートを`getScopedSupabaseClient`へ段階移行

## マスターキー(service_role)漏洩・乗っ取り対策

限定カギ方式(RLS)は「日常業務のバグ」への保険であり、「service_roleキーそのものが
漏れる」「サーバーが乗っ取られる」ケースは別の対策が要る、とオーナーに説明済み。
そのうち以下を実施した／実施が必要。

### 実施済み：異常検知バッチ（気づくまでの時間を短くする対策）

正規の管理者セッションは1つのcompany_idに固定される。よって`admin_audit_log`上で
「同じadmin(actor_id)が短時間に複数のcompany_idにまたがって操作している」状態は、
通常あり得ない。これが起きていたら、service_role漏洩か、セッション/company_id発行
ロジックのバグを疑う。

- `src/lib/anomaly-detection.ts`：検知の純粋関数（`scripts/anomaly_detection_selftest.ts`で
  テスト済み、`npm test`に登録済み）
- `src/app/api/internal/anomaly-check/route.ts`：`admin_audit_log`を直近70分ぶん確認し、
  異常があればSentryに通知。`INTERNAL_CRON_SECRET`で保護（未設定/不一致なら401、
  フェイルクローズ確認済み）
- `.github/workflows/anomaly-check.yml`：1時間ごとに上記を叩く（`health-check.yml`と
  同じ形）。異常時はジョブを失敗させ、GitHubの自動メール通知に乗せる

**オーナーが行うこと**：GitHub リポジトリの Settings → Secrets and variables →
Actions に `INTERNAL_CRON_SECRET`（32文字以上のランダム値）を追加し、同じ値を
Vercelの環境変数にも `INTERNAL_CRON_SECRET` として追加する。

### 未実施：接続元IP制限（侵入・漏洩そのものへの対策として費用対効果が最も高い）

Supabaseダッシュボード → Project Settings → Database → Network Restrictions で、
Vercelが使うIP範囲以外からの接続を拒否できる。**これはSupabaseプロジェクト側の設定で、
コードからは実施できないため、オーナーが直接ダッシュボードで設定する必要がある。**
service_roleキーが万一漏れても、許可されたIP範囲外からは使えなくなる。

### 未実施：鍵ローテーション訓練

`RUNBOOK`6章に手順はあるが、実際に訓練していない（`architecture_state.md`6章に
既に記載の通り、リストア手順も同様に未訓練。安全な訓練環境が要る、という同じ課題）。
次のメンテナンスウィンドウで一度実際にservice_roleキーをローテーションしてみることを
推奨する。
