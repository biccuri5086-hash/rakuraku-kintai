# 次にやること（TODOリスト）

最終更新: 2026-09-09（内容更新。スコアは2026-08-19時点の86〜88/100のまま未再採点）
> 本番アプリは実運用できる状態。以下は「90点以上」と「運用の仕上げ」のための残タスク。
> 記号：🧑=あなたの操作　🤖=カイ（私）がやる

## 未決定：復元テスト用Supabaseプロジェクトの扱い（2026-09-09発生）
リストア訓練で作成した「本番の実データを含む復元用プロジェクト」がそのまま残っている。
- 🧑 A. 削除する　／　B. staging環境として使い続ける（本番同水準のセキュリティ対策が別途必要）
のどちらにするか、まだ決めていない。

---

## 本番のバックアップ（2026-09-09発見 → 同日 Pro Plan にアップグレードして対応）
Supabase本番プロジェクトがFree Planで自動バックアップが無かった問題は、
Pro Planへのアップグレードで対応済み。残りの確認・仕上げ：
- 🧑 `Database → Backups`に実際にバックアップが並んでいるか確認（アップグレード直後は
  最初の日次バックアップがまだの可能性あり。手動で`Create backup`できるなら実行推奨）
- 🧑/🤖 実際に一度リストア手順（RUNBOOK 3章）を安全な形で訓練する（本番データは使わない。
  下記「ステージング環境」の再作成後に行うのが安全）

## A. ステージング環境の完成（保留中・後日・要作り直し）
以前作成していたSupabaseプロジェクト（`xkrwwrittprbpxlvucuu`）が**アカウント上から
無くなっていることを2026-09-09に確認**（無料プランの一時停止・自動削除等が原因と推測）。
下記手順はこのプロジェクトの存在を前提にしているため、**再開する場合は新規プロジェクト作成から**。

Preview環境変数が staging に届いていない（`/api/health` が `project: unknown`）状態で中断。
（旧）再開時の手順の参考：
1. 🧑 Vercel → Settings → Environment Variables で、**Preview用**の3変数が staging の値になっているか確認・修正
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://xkrwwrittprbpxlvucuu.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = staging の anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = staging の service_role key
   - ※ クォート/スペース禁止・特定ブランチ限定を外す
2. 🧑 Vercel → Deployments → `staging` の最新Preview → **Redeploy**（環境変数は新ビルドのみ反映）
3. 🧑 Preview URL の `/api/health` で `project` が `xkrwwrittprbpxlvucuu`・`db: up` を確認
4. 🧑 `/superadmin` にログイン：`staging@rakuraku.local` / `test2026`（seedは投入済み）
5. 🧑 もしログイン画面(Vercel認証)で入れない → Settings → Deployment Protection → Vercel Authentication を Off
- 参考：seedのSQL・接続情報は本ドキュメント下部と `db/staging-bootstrap.sql`

## B. 死活監視の仕上げ（Aで一部完了済み）
> **`specs/死活監視・アラート設定手順書.md` に画面操作つきの手順をまとめました。まずそれを開いてください。**
> Sentry・GitHub Actions（Health Check）による監視の**仕組み自体はコードに実装済み**。
> 残っているのは画面設定（通知ON）と動作確認のみ。UptimeRobot登録は不要（Health Checkが代替）。
- 🧑 SentryのDSN（`SENTRY_DSN`・`NEXT_PUBLIC_SENTRY_DSN`）がVercelに登録されているか確認
- 🧑 Sentry のアラートルール（新規Issue／急増）をメール通知ON
- 🧑 Vercel の Deployment Failed 通知をON
- 🧑 GitHubの通知設定でActionsの失敗通知が有効か確認

## C. 販売前セキュリティ対応 — ✅ 完了済み
STEP0（LINEログイン強制バグ修正）・STEP1（運営者パスワード変更＋2FA）・STEP2（RLS強化
`0006_rls_hardening.sql`適用）とも完了確認済み。手順は`specs/手順書_販売前セキュリティ対応.md`参照。

---

## D. スコアを上げる（90→その先）
- 🤖/🧑 UX整理：管理ナビが8タブで密。グルーピングやオンボーディング導線の改善
- 🧑 実顧客の獲得（“解約ゼロ実績”は時間でしか買えない加点）

## D2. 専門家への相談（資料は準備済み・実際の送付が未着手）
- 🧑 社労士：`specs/社労士相談資料.md`（依頼先の見つけ方・打診メール文面つき）。給与計算・
  派遣法まわりのスポット相談を依頼する
- 🧑 弁護士：`specs/弁護士相談資料.md`（依頼先の見つけ方・打診メール文面つき）。利用規約・
  プライバシーポリシーのスポット相談を依頼する
- どちらも、依頼先が決まったら実際に送付し、回答が来たらこのTODOを更新する

## E. 機能バックログ（顧客が付いてから / 必要になったら）
- 🤖 シフト表（カレンダー）UI
- 🤖 LINEでのシフト通知
- 🤖 有給の勤続年数からの自動付与（現状は管理者が手動付与）
- 🤖 労基法改正の施行時対応 → `specs/労基法改正_見張りリスト.md` を参照（現状は提出見送りで対応不要）

## F. ビジネス（営業）
- 🧑 直販でクロージング、外注はアポ取りだけ（`sales/` 資料・営業戦略メモ準拠）。営業代行フル委託はPMF後。

---

## 参考：現状できていること（本番稼働中）
- スタッフ：LINEで1タップ打刻・GPS・退勤時コンディション
- 管理：派遣先/契約/シフト（追加・編集・削除）
- 給与：残業(日8h/週40h/月60h超50%)・深夜・法定休日・休憩控除・締め確定・CSV・日次ドリルダウン
- 派遣法：抵触日アラート(クーリング考慮)・通知書・管理台帳(37条項目)・台帳設定
- 有給：付与/取得/残高、課金：プラン管理、運営者：会社/管理者管理・2FA・監査ログ
- 運用：CI(lint/型/テスト/build)・DB自動マイグレーション・/api/health・運用手順書(RUNBOOK)・通し検証(`npm run dogfood`)

## 参考：staging ログインseed（再掲・staging DBにだけ流す）
```sql
insert into super_admins (email, password_hash, full_name, is_active)
values ('staging@rakuraku.local',
  'scrypt$16384$807bec0429954f748f00851a8536eb16$5b1e51b487ccaca15e1709254240dba09085b1d583409b97470b6f1305de36785036a6d5e6550171f29681aec30ddf421bf41f80a9de2cd4cc5a379c36b12ef8',
  'ステージング運営者', true)
on conflict (email) do update set password_hash = excluded.password_hash, is_active = true;
```
