# マルチテナント化 本番反映ガイド

このドキュメントを上から順番に実施すると、ラクラク勤怠が複数派遣会社に対応した状態で稼働します。

所要時間：**60分**

---

## ⚠️ 重要：作業中は管理画面にアクセスできません

旧パスワード方式から新方式（メール+パスワード）に切り替わるため、
**STEP 4 まで完了するまで `/admin/login` が使えません**。

作業前に「現在のスタッフへのアナウンスは不要か」を確認してください。
（顧客0社の現時点なら影響なし）

---

## STEP 1：Supabase バックアップ（5分）

1. https://app.supabase.com にログイン
2. プロジェクトを選択
3. 左サイドバー：**Database** → **Backups**
4. 「**Take a manual backup**」をクリック
5. 完了まで2〜3分待つ

→ 万が一の時、ここから1クリックで巻き戻せます。

---

## STEP 2：マイグレーションSQL実行（10分）

1. Supabaseで左サイドバー：**SQL Editor**
2. **New query** をクリック
3. 以下のファイルの内容をすべてコピペ：
   ```
   rakuraku-kintai/らくらく勤怠/specs/MULTITENANT_MIGRATION.sql
   ```
4. 右下の **Run** をクリック
5. 完了メッセージに以下が含まれていることを確認：
   - `初期テナント作成完了: ラクラク勤怠株式会社`
   - `既存データを初期テナントに紐付け完了`

### 確認クエリの結果
- companies に「ラクラク勤怠株式会社」が1行
- rowsecurity が8テーブルすべて `true`
- policyname が0件
- company_id が `is_nullable = NO`

すべて満たしていればOK。

---

## STEP 3：プラットフォーム管理者のパスワード作成（5分）

ローカルPCのターミナル（PowerShell or bash）で：

```bash
cd c:/Users/PC_User/Desktop/AI動画/rakuraku-kintai
node scripts/hash-password.mjs "Rakurakukintai 2026@"
```

→ `scrypt$16384$...` という長い文字列が出力されます。
→ 全部コピーしておきます。

### Supabase で SuperAdmin を作成

1. Supabase の **SQL Editor**
2. `rakuraku-kintai/らくらく勤怠/specs/SUPERADMIN_SEED.sql` をコピペ
3. `<ここにハッシュを貼り付け>` を上記でコピーしたハッシュに置き換え
4. **Run** をクリック
5. 確認：`super_admins` に1行（biccuri5086@gmail.com）が出力されればOK

---

## STEP 4：Vercel 環境変数の追加（5分）

1. https://vercel.com/dashboard
2. `rakuraku-kintai` → **Settings** → **Environment Variables**
3. 以下を追加（既にあるものは更新）：

| 変数名 | 値 | 備考 |
|---|---|---|
| `SESSION_SECRET` | （32文字以上のランダム文字列） | 下記コマンドで生成 |

### SESSION_SECRET 生成（ターミナル）
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

→ 出力された文字列をそのまま Vercel に登録。

### 削除する変数（不要になったもの）
- `ADMIN_PASSWORD` → 削除（新方式ではメール+パスワードで認証するため）
- `ADMIN_TOTP_SECRET` → 削除（2FAはテナント管理者ごとに設定）
- `ADMIN_PASSWORD_HASH` → もしあれば削除

---

## STEP 5：Vercel 再デプロイ（5分）

1. **Deployments** タブ
2. 一番上のデプロイ → 「**...**」→ **Redeploy**
3. 「Use existing Build Cache」のチェックを**外す**
4. **Redeploy** クリック
5. 2〜3分待つ（緑のReady表示まで）

---

## STEP 6：プラットフォーム管理画面でログイン（5分）

1. ブラウザで以下を開く：
   ```
   https://rakuraku-kintai-frb6.vercel.app/superadmin/login
   ```
2. ログイン情報を入力：
   - メール：`biccuri5086@gmail.com`
   - パスワード：`Rakurakukintai 2026@`
3. ✅ ログイン成功すれば、プラットフォーム管理画面が表示される

### 確認できること
- 「ラクラク勤怠株式会社」が1件のテナントとして表示
- 招待リンクが発行されている

---

## STEP 7：自分用のテナント管理者アカウントを作る（5分）

1. プラットフォーム管理画面で「**ラクラク勤怠株式会社**」の「**詳細**」をクリック
2. 「**テナント管理者**」セクションで「**追加**」をクリック
3. 入力：
   - 氏名：`小原 健太`
   - メール：`biccuri5086@gmail.com`
   - 初期パスワード：`Rakurakukintai 2026@` （または別のパスワードでも可）
4. **追加** をクリック

→ これで「テナント管理者」としても自分のアカウントが作成されました。
→ 以後、社内テスト用は `/admin/login` から、テナント運営は `/superadmin/login` からアクセス。

---

## STEP 8：ログイン動作確認（5分）

### テナント管理者ログイン
1. https://rakuraku-kintai-frb6.vercel.app/admin/login
2. メール：`biccuri5086@gmail.com`
3. パスワード：（STEP 7で設定したもの）
4. ✅ ログイン成功 → 管理ダッシュボードが表示
5. 既存のテストデータ（自分の打刻記録など）が見えることを確認

### スタッフLINE経由ログイン
1. LINE公式アカウントから既存リンクで開く
2. ✅ 既存スタッフ（自分）のデータが見える
3. 打刻・コンディション報告が動作する

---

## STEP 9：認証情報.txt の更新（5分）

`c:\Users\PC_User\Desktop\AI動画\認証情報.txt` を以下の通り更新：

```
─────────────────────────────────────────
■ プラットフォーム管理者（小原健太・あなた専用）
─────────────────────────────────────────

URL    ：https://rakuraku-kintai-frb6.vercel.app/superadmin/login
メール ：biccuri5086@gmail.com
パスワード：Rakurakukintai 2026@

役割：派遣会社（テナント）の登録・削除・機能フラグ管理

─────────────────────────────────────────
■ ラクラク勤怠株式会社（自社テナント管理者）
─────────────────────────────────────────

URL    ：https://rakuraku-kintai-frb6.vercel.app/admin/login
メール ：biccuri5086@gmail.com
パスワード：Rakurakukintai 2026@

役割：自社スタッフの勤怠を見る（テストアカウント）
```

---

## STEP 10：新規派遣会社の追加テスト（10分）

実際の顧客追加の流れを確認しておきましょう。

1. `/superadmin` で「**新規追加**」
2. 会社名：「テスト派遣株式会社」
3. プラン：スタンダード、状態：試用中
4. **作成**
5. 詳細画面に行き、招待リンクをコピー
6. ブラウザのシークレットウインドウでそのリンクを開く
7. （実際にスタッフ登録するわけではないので、ここまでで確認終了）
8. テスト用なので、最後に「**このテナントを削除**」で削除

---

## ✅ 完了後チェックリスト

- [ ] Supabaseのcompaniesに「ラクラク勤怠株式会社」が存在
- [ ] super_adminsに小原健太のアカウントが存在
- [ ] /superadmin/login でログインできる
- [ ] /admin/login で（テナント管理者として）ログインできる
- [ ] 既存のテストデータ（打刻履歴など）が引き続き見える
- [ ] LINEからのスタッフ操作（打刻・コンディション）が動作する
- [ ] 認証情報.txt を最新状態に更新済み

---

## 🚨 トラブル時の連絡先

ログインできない・データが消えた場合：
1. Supabase Backups から STEP 1 で取ったバックアップを復元
2. Vercel Deployments で前のデプロイにロールバック

このマイグレーションは **冪等** に設計されているので、もう一度 SQL を流しても重複は作られません。

---

## 🎯 新規派遣会社を契約したときの流れ（参考）

1. `/superadmin` で「新規追加」 → 会社情報入力
2. 招待リンクをコピー
3. 派遣会社の社長に LINE/メールで送付
4. 派遣会社の管理者用アカウントを作成（パスワード初期発行）
5. パスワードを安全な方法で社長に伝える
6. 社長が `/admin/login` でログイン → 自社スタッフを管理開始
7. 派遣スタッフは招待リンクから登録 → 即LINE打刻運用開始

→ **テナント追加〜運用開始まで30分**で完結します。
