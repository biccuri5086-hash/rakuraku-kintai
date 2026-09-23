# RLS 限定カギ方式 — 設計・導入状況

最終更新: 2026-09-23（オーナー承認・カイ実装。フォローアップ完了回）

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
| DB: 専用ロール + RLS(初回) | `db/migrations/0008_scoped_tenant_role.sql` | `app_tenant`ロール新設。13テーブルに`company_id = app_tenant_company_id()`のRLSポリシー。`admin_audit_log`はSELECT/INSERTのみ(改ざん耐性) |
| DB: RLS対象拡大 | `db/migrations/0009_scoped_tenant_role_extend.sql` | `paid_leave_grants` / `paid_leave_takings` / `compliance_settings` / `tenant_settings` / `admins`を追加(通常のCRUDパターン)。`companies`は`id = app_tenant_company_id()`でSELECT/UPDATEのみ(会社の作成・削除はここでは行わないため)。`company_subscription`のDELETE権限を剥奪(最小権限に是正) |
| JWT発行・検証 | `src/lib/tenant-jwt.ts` | `role: app_tenant`, `company_id`クレーム付きHS256 JWT（TTL 60秒）。純粋関数、環境変数への依存は`mintTenantAccessToken`のみに隔離 |
| 鍵強度チェック | `src/lib/security-guard.ts` | `requireSupabaseJwtSecret`を追加（`SESSION_SECRET`と同じ強度基準、別鍵として管理） |
| スコープ付きクライアント | `src/lib/supabase-tenant.ts` | `getScopedSupabaseClient(companyId)`。`getSupabaseAdmin()`の代替 |
| selftest | `scripts/tenant_jwt_selftest.ts` | 署名検証・TTL・改ざん検知・鍵不一致を検証。`npm test`に登録済み |
| 静的検査の拡張 | `scripts/tenant_isolation_test.ts` | TENANT定数に`paid_leave_grants` / `paid_leave_takings` / `compliance_settings` / `tenant_settings`を追加(既存の抜け穴を解消)。`admins`/`companies`はcompany_idカラムの持ち方が違うため、この静的検査の対象には含めていない(RLS側では保護済み) |
| 適用済みルート | `src/app/api/admin/**` | **`login`を除く全22ルート**を`getScopedSupabaseClient`に切り替え済み。`login/route.ts`はメールアドレスだけでの全社横断検索が本質的に必要なため、意図的に`service_role`のまま。`logout/route.ts`はDBアクセスが無いため対象外 |

`npm test` / `npx eslint` / `npx tsc --noEmit` / `npm run build` / 全ルートの401疎通確認(ブラウザ相当)は全て通過確認済み。

## 未実装・残作業

1. **`/api/superadmin/**`・`pg_cron`バッチは対象外のまま**（設計上、全社横断アクセスが
   必要なため。`service_role`を使い続ける。意図的な設計判断であり、抜け漏れではない）。
2. **`login`ルートはservice_roleのまま**（同上、構造上の必然）。

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

### 2.5 ステージング検証チェックリスト（ノア指摘・0009で対象拡大したため追加）

`clients`単体ではなく`login`以外の全ルートが一度に切り替わったため、以下は
**必ず2社分のテストデータで**相互に見えないことまで確認すること。

- [ ] ログイン〜2FA〜ログアウトが問題なく通る(`login`はservice_roleのまま・無変更)
- [ ] `/admin`(自分の会社情報)・`/admin/2fa-setup`・パスワード変更が動く
      (`admins`テーブルのRLS適用後)
- [ ] 派遣先・契約・シフト・スタッフのCRUD(作成・編集・削除)が一通り動く
- [ ] 給与(payroll)のプレビュー・確定・締め出力が動く
- [ ] 有給の付与・取得の登録が動く(`paid_leave_grants`/`paid_leave_takings`)
- [ ] コンプライアンス台帳・アラート・通知・設定画面が表示・保存できる
      (`compliance_settings`/`compliance_acks`)
- [ ] 課金プラン変更(`company_subscription`のUPSERT)が動く。DELETEが不要なことも
      前提通りか確認(削除ボタン等が無いことの再確認)
- [ ] 監査ログ画面が表示できる(`admin_audit_log`のSELECT)
- [ ] **A社のログインでB社のIDを直接指定してAPIを叩いても0件/エラーになること**
      (RLSが実際に効いているかの本命確認。`clients`だけでなく`admins`・
      `companies`・`paid_leave_*`でも試す)

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

### フォローアップ実装(2回目)のダブルチェック

- **ハヤト**：admins(password_hash/totp_secret)へのRLSは問題なし(各ルートは常に
  自分自身のadmin行しか読まない)。login除外の判断は妥当。20ルートの機械置換に
  companyId取り違えなし。**[Low・対応済み]** companiesへのUPDATE権限が実際には
  どの管理者向けAPIも使っていないのに一律付与されていた → その場でSELECTのみに
  絞り直した(将来self-service設定機能が要る場合は列を絞ったGRANTを別途追加する
  方針をコメントに明記)。判定：承認。
- **ノア**：最小権限の原則は維持されている。**[要注意]** 当初「`clients`単体で
  段階検証してから展開する」計画だったが、オーナーの明示的な指示により、
  本番未検証のまま一度に`login`以外の全20ルートへ拡大した。これは元の
  段階的ロールアウト計画からの逸脱であり、**もしJWT+PostgRESTロール切替の
  仕組み自体に構造的な問題があった場合、1ルートではなく全ルートが同時に
  影響を受ける**リスクがある。ブロッカーにはしない(オーナー承認済み・
  まだmainには入っていない)が、**ステージング検証は「2.5」のチェックリストを
  必ず全項目終えてからマージすること**。判定：承認(要ステージング全項目検証)。

## 未着手のフォローアップ → 全て対応完了（0009・ルート移行で解消）
1. ~~`paid_leave_grants` / `paid_leave_takings` / `compliance_settings`をRLS対象に追加~~ → 0009で対応
2. ~~`admins` / `companies`へのRLS拡張~~ → 0009で対応
3. ~~`company_subscription`のDELETE権限~~ → 0009で剥奪済み
4. ~~`clients`以外の22ルートを`getScopedSupabaseClient`へ段階移行~~ → `login`を除く全ルート完了

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
