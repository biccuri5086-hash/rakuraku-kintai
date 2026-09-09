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

> **2026-09-09 発見 → 同日 Pro Plan にアップグレードして解消。**
> Free Planでは自動バックアップが一切無いことが判明（「Free Plan does not include
> project backups.」）。Pro Planへのアップグレードにより、日次の自動バックアップ
> （Scheduled backups、7日分）が有効になったはず。**次回作業時に必ず、実際に
> `Database → Backups`にバックアップが並んでいるか確認すること**（アップグレード直後は
> 最初のバックアップがまだ走っていない可能性がある。手動で`Create backup`できるなら、
> それも合わせて実行しておく）。

- **Supabase 自動バックアップ**: Pro Planで日次自動（7日分。**分単位で戻せるPoint-in-Time
  Recoveryは別売りの追加オプションで、現在は未契約**）。
- **手動バックアップ（重要変更の前に推奨）**:
  - Supabase → Database → Backups から手動バックアップ、または
  - `pg_dump`（接続文字列は Connect → Session pooler）でローカルにダンプを取得。
- **マイグレーション前**は必ずバックアップ（rules.md Rule 1 準拠）。additive設計だが保険。
  Free Planの間は、上記の`pg_dump`を必ず実施すること（ダッシュボードのボタンに頼らない）。

## 3. リストア（復旧）

> 2026-09-09にPro Planへアップグレードし、2章の自動バックアップの前提は解消済み。
> ただし、まだ実際にこの手順（Backupsからの復元）を訓練していない。安全な形での
> リストア訓練は未実施のため、初めて使うときが本番装備での初回、という状態が続いている。

**「本番のテーブルを誤って消してしまった／壊してしまった」ときの手順**

1. まず被害を広げない：これ以上の書き込みが起きないよう、必要なら該当機能を一時停止する
   （Vercelの環境変数を一時的に外す等は最終手段。基本は次のステップに進んでよい）。
2. 影響範囲を確認する（全社に及ぶ事故か、特定の`company_id`だけか）。
3. Supabaseダッシュボードで復元する
   - Supabase → 対象プロジェクト → 左メニュー `Database` → `Backups`
   - Point-in-Time Recovery（PITR）が有効なプランの場合：`Restore` タブから
     **「事故が起きる直前の時刻」**を指定して `Restore` を押す
     （⚠️ 復元は新しいプロジェクトとして作られる場合がある。その場合は接続文字列
     （`DATABASE_URL`・Vercelの`NEXT_PUBLIC_SUPABASE_URL`等）を新プロジェクトのものに
     差し替える必要がある。復元前にSupabaseの画面の案内をよく読むこと）
   - 日次バックアップのみのプランの場合：`Backups` 一覧から直近の復元点を選び `Restore`
   - CLIを使う場合：`pg_dump`で取得済みのダンプがあれば
     `psql "$DATABASE_URL" < backup.sql` で流し込む（`DATABASE_URL`はSession pooler接続文字列）
4. 復元後、`/api/health` が `db:up`、主要画面（`/admin`, `/admin/payroll`, `/admin/compliance`,
   `/superadmin`）が開くことを確認する。
5. `npm run dogfood` で1社分の通し（給与/台帳/抵触日）を実行し、集計が正しいことを確認する。
6. 影響を受けた契約者がいれば、6.2の障害報告テンプレートで連絡する。

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
| `TypeError: Invalid URL`（DB Migrate） | `DATABASE_URL` の値の前後に`"`（ダブルクォート）が入ったまま貼り付けている（コマンド例をそのままコピーした場合に起きやすい） | Secretを開き直し、`postgresql://`から始まって`/postgres`で終わる文字列**だけ**（引用符なし）に貼り替える |
| `password authentication failed for user "postgres"`（DB Migrate） | ①パスワードが違う ②`Direct connection`の文字列を使っている（ユーザー名が`postgres.xxxx`ではなく`postgres`単体になっていないか確認） | Supabaseでパスワード再発行 → `Session pooler`タブの文字列を使う → Secretを更新 |
| `information_schema.routine_privileges`でEXECUTE権限を確認したのに、REVOKEしたはずの関数が消えない | **同名の関数が複数スキーマに存在する**（例：`public`と`staging`に同名関数が別々に存在するケースが実際にあった）。スキーマを指定しないREVOKEは1つのスキーマにしか効かない | `select n.nspname, p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='関数名'` でスキーマを特定し、`revoke execute on function <schema>.<関数名>() from public, anon, authenticated;` のようにスキーマ名を付けて実行する |
| 集計値がおかしい | ロジック/データ不整合 | `npm run dogfood` と `npm test` で切り分け。打刻漏れは要確認で除外される仕様 |

## 6. 秘密情報のローテーション
- **DBパスワード**: Supabase → Database → Reset database password → GitHub Secret `DATABASE_URL` を更新（アプリは service_role 接続なので本番影響なし）。
- **service_role / anon key**: Supabase で再発行 → Vercel 環境変数を更新 → Redeploy。
- **SESSION_SECRET / PHONE_* 鍵**: 変更すると既存セッション無効化・暗号化データ復号不可になり得るため**原則変更しない**。必要時は移行手順を別途設計。

### 6.1 秘密鍵が漏洩した場合の緊急対応（例：GitHub等に誤ってコミットした）

漏洩したのが何かによって対応が変わる。パニックにならず、以下を上から順に実行する。

**`SUPABASE_SERVICE_ROLE_KEY`（RLSを迂回する最強の鍵）が漏洩した場合**
1. Supabase → 対象プロジェクト → `Settings` → `API` → `service_role` キーの **`Reveal`** 横にある
   再発行ボタン（`Roll`/`Regenerate`等の表記）で鍵を再発行する。**旧鍵は即座に無効になる**。
2. Vercel → `Settings` → `Environment Variables` → `SUPABASE_SERVICE_ROLE_KEY` を新しい値に更新。
3. Vercel → `Deployments` → 最新のProductionデプロイの `...` メニュー → **`Redeploy`**
   （環境変数は再デプロイしないと反映されない）。
4. 漏洩元（GitHubのコミット履歴等）に鍵の文字列がまだ残っている場合、該当コミットの削除・
   リポジトリのSecret Scanning等の対応を検討する（旧鍵は既に無効化済みなので、履歴に残っていても
   実害は無いが、念のため）。

**`SESSION_SECRET` が漏洩した場合（全員を強制ログアウトさせたいとき）**
1. Vercel → `Environment Variables` → `SESSION_SECRET` を新しいランダムな値に変更
   （`openssl rand -hex 32` 等で生成。32文字以上・意味のない文字列）。
2. `Redeploy`。
3. **この時点で、管理者・運営者を含む全ての既存セッションが自動的に無効になる**
   （署名が合わなくなるため）。全員が次回アクセス時に再ログインを求められる＝
   意図的にこれを「秘密鍵漏洩時の強制ログアウト」として使ってよい。
4. スタッフ（LINE経由）のログインは別方式のため影響しない。

**`PHONE_ENCRYPTION_KEY`等、データ暗号化に使う鍵が漏洩した場合**
- ⚠️ これは単純に差し替えると**既存の暗号化済みデータ（電話番号）が復号できなくなる**。
  ローテーションには移行スクリプト（旧鍵で復号→新鍵で再暗号化）が必要。**自己判断で変更しない**。
  発生したらまずオーナー確認の上、個別に移行手順を設計する。

## 6.5 解約時のデータ削除（利用規約第17条・プライバシーポリシー10条 対応・自動化済み）

利用規約・プライバシーポリシーで「解約後30日でデータを完全削除する」と約束している。
**2026年9月5日以降、これは自動化されている**（設計：`specs/テナント削除自動化_設計.md`、
マイグレーション：`db/migrations/0007_tenant_cancellation.sql`、ハヤト/ノアのダブルチェック済み）。
運営者が手動でSupabaseにDELETE文を書く運用、および即時物理削除だった旧`DELETE`APIは廃止した。

### 解約の手順（運営者がやること）
1. `/superadmin/companies/[id]` を開き、契約者が打刻データ等をCSV等でエクスポート済みか確認する
   （申し出がなければ、当社側からエクスポート案内を送る）。
2. 同じ画面で「状態」を「解約済み」にする、または「このテナントを解約する（30日後に完全削除）」
   ボタンを押す（会社名の再入力による確認あり）。**この時点ではデータは消えない**
   （`status='cancelled'`, `cancelled_at`が記録されるだけ）。
3. 30日以内に契約者から連絡があれば、「状態」を「稼働中」に戻すだけで完全に復旧できる。
4. 30日経過すると、Supabaseの`pg_cron`が毎晩自動で物理削除する。運営者は何もしなくてよい。

### 月次の目視確認（ノア指摘：自動バッチが止まっていないかの確認）
自動化されているとはいえ、`pg_cron`が何らかの理由で停止すると誰も気づけない
（＝規約で約束した「30日で削除」を守れなくなる）。**月1回程度**、以下を確認する。

```sql
-- 直近の実行結果を確認（解約中の会社があるのに実行記録が無ければ要調査）
select action, details, created_at
from admin_audit_log
where action in ('system_company_purge', 'system_company_purge_failed')
order by created_at desc
limit 20;

-- スケジュールが有効なままか確認
select jobname, schedule, active from cron.job
where jobname = 'purge_cancelled_companies_daily';

-- 30日を超えているのにまだ残っている「解約済み」会社が無いか確認（0行が正常）
select id, name, cancelled_at from companies
where status = 'cancelled' and cancelled_at <= now() - interval '31 days';
```

最後のクエリで行が出た場合、自動バッチが止まっている可能性がある。`cron.job`の`active`が
falseになっていないか、`select purge_cancelled_companies();`を手動実行してエラーが出ないか確認する。

※ 法令上の保存義務がある情報（該当する場合）は、実装時にこの削除フローの対象外とする想定。
　現状はそのようなテーブルは無いため未対応（発生したら`purge_cancelled_companies()`を要修正）。

## 6.2 顧客への障害報告テンプレート

契約者（派遣会社の管理者）へのメール文面。障害の内容に合わせて `［　］` を埋める。
**推測で原因・復旧見込みを断定しない**（後で訂正するより、最初から慎重な書き方にする）。

### 発生時（第一報）

```
件名：【重要】サービス障害のご報告（ラクラク勤怠）

いつもラクラク勤怠をご利用いただきありがとうございます。

現在、以下の障害が発生していることを確認しております。

【発生日時】［　］年［　］月［　］日 ［　］時［　］分頃から
【影響範囲】［例：打刻機能がご利用いただけない状況／管理画面にログインできない状況］
【現在の対応状況】原因を調査中です。

復旧の目処が立ち次第、改めてご連絡いたします。
ご不便をおかけし、誠に申し訳ございません。

ラクラク勤怠
小原 健太
biccuri5086@gmail.com
```

### 復旧時（完了報告）

```
件名：【復旧のご報告】サービス障害について（ラクラク勤怠）

先ほどご報告しておりました障害について、下記のとおり復旧いたしましたのでご報告いたします。

【発生期間】［　］年［　］月［　］日 ［　］時［　］分 〜 ［　］時［　］分
【影響範囲】［　］
【原因】［分かっている範囲で。憶測は書かない。「調査中」でも構わない］
【対応内容】［　］
【今後の再発防止】［分かっていれば。無ければ「原因究明の上、対策を講じます」でよい］

この度はご不便・ご心配をおかけし、誠に申し訳ございませんでした。
今後このようなことがないよう努めてまいります。

ラクラク勤怠
小原 健太
biccuri5086@gmail.com
```

### 送るかどうかの判断の目安
- **必ず送る**：打刻・給与集計・ログインなど主要機能が15分以上使えない障害、個人情報が漏洩した
  疑いがある事象。
- **状況による**：軽微な表示崩れ、数分で自然復旧したもの（気づいた契約者から問い合わせが
  あれば個別に説明する程度でよい）。
- 個人情報漏洩の疑いがある場合は、上記テンプレートに加えて**個人情報保護法上の報告義務**
  （個人情報保護委員会への報告・本人への通知）の要否を確認する。レン（法務）・弁護士に相談する。

## 7. ステージング（推奨・未整備）
- 現状 main → 本番直行。**推奨**: Vercel の Preview（PRごとの自動プレビュー）を検証環境として使う。DBは本番共有を避け、別 Supabase プロジェクトを Preview 用環境変数に割り当てるのが理想（着手候補）。
- ⚠️ **2026-09-09確認：以前作成していたstaging用Supabaseプロジェクト（`xkrwwrittprbpxlvucuu`）が
  Supabaseアカウント上に見当たらなくなっている**（無料プランの一時停止・自動削除等が原因と推測）。
  本ドキュメントの他の箇所（TODOの一部等）にこのプロジェクトIDへの言及が残っているが、
  **現在は存在しない前提で読み直すこと**。ステージング環境に再着手する場合は、
  新しいSupabaseプロジェクトの作成から始める必要がある。

## 8. リリース前チェックリスト
- [ ] `npm run typecheck` / `npm test` が緑
- [ ] `npm run build` 成功
- [ ] DB変更があれば `db/migrations/` に冪等SQLを追加（バックアップ取得済み）
- [ ] 重要変更はハヤト/ノアのダブルチェック＋オーナー承認（rules.md Rule 1）
- [ ] デプロイ後 `/api/health` が `db:up`、主要画面が開くことを確認
