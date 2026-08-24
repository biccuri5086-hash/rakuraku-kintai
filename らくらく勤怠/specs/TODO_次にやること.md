# 次にやること（TODOリスト）

最終更新: 2026-08-19 ／ 現在のプロダクト完成度スコア（リョウ採点）: **約86〜88 / 100**
> 本番アプリは実運用できる状態。以下は「90点以上」と「運用の仕上げ」のための残タスク。
> 記号：🧑=あなたの操作　🤖=カイ（私）がやる

---

## A. ステージング環境の完成（保留中・後日）
Preview環境変数が staging に届いていない（`/api/health` が `project: unknown`）状態で中断。
再開時の手順：
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
- 🧑 UptimeRobot に `https://rakuraku-kintai.vercel.app/api/health` を登録（未なら）
- 🧑 Sentry のアラートルール（新規Issue／急増）をメール通知ON
- 🧑 Vercel の Deployment Failed 通知をON

## C. 【最優先】販売前セキュリティ対応 — 専用の手順書あり
> **`specs/手順書_販売前セキュリティ対応.md` に画面操作つきの手順をまとめてあります。まずそれを開いてください。**
- 🧑 STEP 0：`claude/rakuraku-kintai-final-test-iy5q7i` を main にマージ → Vercel デプロイ確認
- 🧑 STEP 1：運営者パスワードを変更（現在は開発時のものがリポジトリに残存）＋ 2FA を有効化
- 🧑 STEP 2：`0006_rls_hardening.sql` を本番DBに適用し、`pg_policies` が0行であることを確認
  （開発用の全許可ポリシーが本番に残っていると、anonキーで全社データが読める）

---

## D. スコアを上げる（90→その先）
- 🤖/🧑 UX整理：管理ナビが8タブで密。グルーピングやオンボーディング導線の改善
- 🧑 実顧客の獲得（“解約ゼロ実績”は時間でしか買えない加点）

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
