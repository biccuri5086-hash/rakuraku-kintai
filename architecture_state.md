# architecture_state.md — 既存実装インデックス

最終更新: 2026年9月6日

> **これは何のためのファイルか**：新しい機能追加・改修を依頼する前に、必ずこのファイルを確認する。
> 「既に実装されている仕組みを知らずに、AIが重複実装してしまう」事故（Sentry/死活監視を
> 知らずにDiscord Webhookを提案されかけた事例が実際にあった）を防ぐためのインデックス。
> **詳細な設計・手順は各specsファイルにある。ここは「どこに何があるか」の地図。**

---

## 1. 技術スタックと主要ライブラリ

| 領域 | 技術 | 備考 |
|---|---|---|
| フロントエンド/バックエンド | Next.js 16（App Router）／React 19／TypeScript | `src/app/api/**` がAPIルート、`src/app/**` が画面 |
| DB・認証基盤 | Supabase（Postgres） | アクセスは全て`service_role`経由。RLSは有効・ポリシー0件（anon/authenticatedは何も読めない） |
| ホスティング | Vercel | mainブランチが自動デプロイ |
| エラー監視 | `@sentry/nextjs` (^10.54.0) | 後述4章 |
| スタッフ認証 | `@line/liff` | LINE LIFFでの打刻画面のみ使用（`/` `/register` `/condition`） |
| パスワードハッシュ | 独自実装（scrypt、`src/lib/password.ts`） | 外部ライブラリ不使用 |
| 2FA | 独自実装（TOTP、`src/lib/totp.ts`、`qrcode`でQR生成） | シークレットはサーバー内生成、外部送信なし |
| DB接続（マイグレーション用） | `pg`（devDependency） | `scripts/migrate.mjs`専用、アプリ本体は`@supabase/supabase-js`のみ使用 |
| スタイリング | Tailwind CSS v4 | |
| CI | GitHub Actions | `ci.yml`（lint/typecheck/test/build）／`migrate.yml`（DB自動適用）／`health-check.yml`（死活監視） |

**外部の重量級フレームワーク（認証SaaS、ORM等）は意図的に使っていない。** 認証・暗号化はすべて
`src/lib/`内の独自実装（scrypt/HMAC/AES-GCM等のNode標準crypto利用）。新機能でこの方針を変える
（例：NextAuth導入、Prisma導入）場合は、既存の認証・テナント分離の仕組み全体に影響するため、
必ず事前にオーナー確認（rules.md Rule 1）。

## 2. ディレクトリ構成の要点

```
src/app/            # 画面(App Router)。admin(顧客管理者) / superadmin(運営) / api(APIルート)
src/app/api/admin/  # 顧客管理者向けAPI。全てtenant-context.ts経由でcompany_idをセッションから導出
src/app/api/me/     # スタッフ(LINE)向けAPI。clock/condition/gps/register/profile/today
src/app/api/superadmin/ # 運営者向けAPI
src/lib/            # 認証・暗号化・監査ログ・給与計算・派遣法コンプライアンス等のロジック本体
db/migrations/      # 自動適用されるマイグレーション(0001〜)。README.md参照
scripts/            # selftest群(npm testで実行)・migrate.mjs・dogfood_test
らくらく勤怠/specs/  # 設計書・運用手順書・法務ドラフト・営業資料以外の実務ドキュメント
らくらく勤怠/sales/  # 営業資料・LP・マニュアル
.claude/skills/     # AI社員(カイ/ソラ/ハヤト/ノア/リョウ/ミオ/レン)・/goal実行モード
```

**テナント分離はアプリ層の責任**（RLSはservice_roleを通すだけで機能しない設計）。
`src/lib/tenant-context.ts`の`requireTenantContext()`が唯一の`company_id`導出経路。
`scripts/tenant_isolation_test.ts`が`src/app/api/admin/**`を静的検査し、リクエスト由来の
`company_id`を使っているコードがあれば`npm test`が落ちる。

## 3. データベース構成

主要テーブル（`company_id`で全てテナント分離、FKは`companies`への`on delete cascade`で統一済み）：

| テーブル | 役割 |
|---|---|
| `companies` | テナント（派遣元企業）マスタ。`status`に`active/trial/suspended/cancelled`、`cancelled_at` |
| `admins` / `super_admins` | 管理者/運営者アカウント（email, password_hash, totp_secret） |
| `user_profiles` | スタッフ（LINEユーザー）。`phone`はAES-256-GCM暗号化保存 |
| `attendance` / `condition_reports` | 打刻・体調報告 |
| `clients` / `assignments` / `shifts` | 派遣先・契約・シフト |
| `company_payroll_settings` / `timesheets` / `timesheet_entries` / `payroll_exports` | 給与 |
| `compliance_acks` / `compliance_settings` | 派遣法コンプライアンス（抵触日・管理台帳） |
| `paid_leave_grants` / `paid_leave_takings` | 有給 |
| `company_subscription` | プラン管理（**決済の自動化は未実装**。手動でプラン選択するだけ） |
| `admin_audit_log` | 監査ログ。`company_id`は`on delete set null`（会社削除後も履歴は残す設計） |
| `rate_limits` | ログイン試行のレート制限（IPベース、`service_role_only`ポリシー） |

新しいテナントスコープのテーブルを作る場合は、`company_id uuid not null references companies(id) on delete cascade`
のパターンを踏襲すること（解約時の自動物理削除が正しく連鎖するため。4章参照）。

## 4. 監視・ログ基盤の現状（**ここを見ずに新規実装しない**）

| 仕組み | 実装場所 | 状態 |
|---|---|---|
| バックエンドの例外収集 | `src/lib/api-handler.ts`の`errorResponse()`が全APIルートの`catch`から呼ばれ`Sentry.captureException()` | ✅ 実装済み。要`SENTRY_DSN`（Vercel環境変数） |
| フロントの致命的エラー収集 | `instrumentation-client.ts`（`NEXT_PUBLIC_SENTRY_DSN`必須） | ✅ 実装済み |
| サーバー起動時エラー | `instrumentation.ts`（Next.jsの`onRequestError`） | ✅ 実装済み |
| 外形監視（死活監視） | `.github/workflows/health-check.yml`。10分ごとに`/api/health`を叩き、失敗でGitHubがメール通知 | ✅ 実装済み。**UptimeRobot等は不要**（これが代替） |
| 監査ログ | `src/lib/audit-log.ts`の`logAudit()`。IPアドレス・UA・操作種別を`admin_audit_log`に記録 | ✅ 実装済み |
| アラート設定の仕上げ手順 | `specs/死活監視・アラート設定手順書.md` | 手順書あり。画面設定（Sentry ON等）は運営者の実操作待ち |

**新しくエラー通知や死活監視を「作って」と言われたら、まずこの表を見て、
本当に足りないのか（設定ONにするだけではないか）を確認すること。**

## 5. データの削除・保持方針

利用規約第17条・プライバシーポリシー10条で「解約後30日で完全削除」を約束しており、
以下で自動化済み（設計：`specs/テナント削除自動化_設計.md`、2026-09-06 本番適用済み）。

1. **論理削除**：`PATCH /api/superadmin/companies/[id]`または解約ボタンで`companies.status='cancelled'`、
   `cancelled_at=now()`をセット（`src/app/api/superadmin/companies/[id]/route.ts`）。
2. **アプリ層での締め出し**：`src/lib/tenant-context.ts`の`isCompanyBlocked()`が
   `getTenantContext()`（全`/api/admin/*`）と`/api/me/clock`・`condition`・`gps`から呼ばれ、
   `cancelled`/`suspended`なら401/403にする。
3. **物理削除**：`db/migrations/0007_tenant_cancellation.sql`で定義した
   Postgresの`purge_cancelled_companies()`関数を、Supabaseの`pg_cron`が毎日18:00 UTC
   （深夜3時JST）に自動実行。`cancelled_at`から30日経過した会社を`delete from companies`
   （子テーブルは`on delete cascade`で連鎖削除）。実行結果は`admin_audit_log`に記録。
4. **セキュリティ**：上記関数は`anon`/`authenticated`/`PUBLIC`からのEXECUTE権限を明示的に
   剥奪済み（Supabase経由で外部から呼べないように）。同名関数が別スキーマに重複して存在し得る
   ことが判明したため、権限確認は必ずスキーマ込みで行うこと（RUNBOOKのトラブルシュート参照）。

**新しいテナントスコープのテーブルを追加した場合、`company_id`のFKを`on delete cascade`に
しておけば、上記の物理削除フローに自動的に組み込まれる（追加のコード変更は不要）。**

## 6. インシデント対応

全て `らくらく勤怠/specs/運用手順書_RUNBOOK.md` に集約（**新しいインシデント対応ドキュメントを
別途作らない方針**。1人運用でドキュメントが分散すると見落としの元になるため）。

> 2026-09-09、本番がFree Planでバックアップが無いことが発覚 → 同日Pro Planにアップグレードし解消。
> ただしリストア手順（RUNBOOK 3章）は**まだ実際に訓練していない**（安全な訓練環境が要る）。
> また、以前存在した staging用Supabaseプロジェクトはアカウントから無くなっている（未解決）。

- リストア手順（Supabase PITR/バックアップからの復旧、画面操作レベル）：RUNBOOK 3章
- マイグレーションのロールバック：RUNBOOK 4章
- よくある障害と対処（DB Migrate失敗、ログイン不可等）：RUNBOOK 5章
- 秘密鍵ローテーション・漏洩時の緊急対応（service_role key再発行、SESSION_SECRET変更による
  強制ログアウト）：RUNBOOK 6章
- 解約時のデータ削除フロー：RUNBOOK 6.5章
- 顧客への障害報告メールテンプレート：RUNBOOK 6.2章

## 7. 法務文書の状態

- `らくらく勤怠/specs/terms.md` / `privacy.md`：ドラフト。損害賠償上限の重過失除外・委託条項は
  反映済みだが**弁護士未確認**。本番ページ（`src/app/terms/`・`src/app/privacy/`）には、
  弁護士確認前の変更は反映していない（自明に安全な修正のみ本番反映済み：特商法の決済表記修正等）。
- `らくらく勤怠/specs/弁護士相談資料.md`：スポット相談用の論点整理（優先度付き）。まだ相談・回答待ち。
- `らくらく勤怠/specs/労務レビュー_ミオ一次チェック.md`：給与・派遣法の論点整理。社労士に相談送付済み、回答待ち。

## 8. 今後のタスク依頼時のルール

新しい機能追加・改修を依頼された（またはGemini等の外部AIの提案を実行しようとする）ときは：

1. **まずこのファイルを読み、該当領域が既に実装済みでないか確認する。**
2. 実装済みなら、重複実装ではなく「設定を仕上げる」「既存の仕組みを拡張する」方向を優先する。
3. 確信が持てない場合は、断定的に「無い」と言わず、コード（`src/`, `db/migrations/`,
   `らくらく勤怠/specs/`）を実際に検索してから答える。
4. このファイルが実態と食い違ってきたら、気づいた時点で更新する（実装済み一覧は生きた文書）。
