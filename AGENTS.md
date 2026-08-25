<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ラクラク勤怠 — プロジェクトの要点

派遣会社向けの勤怠管理SaaS。スタッフはLINE(LIFF)で打刻し、派遣会社の管理者と
運営者(自社)がWeb画面で管理する。本番は Vercel、DBは Supabase。

## 画面と入口

| 対象 | パス | 認証 |
|---|---|---|
| スタッフ | `/` `/register` `/condition` | LINE(LIFF)。**この3つ以外でLIFFを読み込まないこと** |
| 顧客の管理者 | `/admin/**` | メール+パスワード(+任意で2FA)。Cookie `rk_tenant_session` |
| 運営(自社) | `/superadmin/**` | 同上。Cookie `rk_super_session` |
| 公開 | `/lp` `/privacy` `/terms` `/legal` `/api/health` | なし |

本番URL: `https://rakuraku-kintai.vercel.app`

## 触る前に知っておくこと

- **RLSは使っていない。** 全テーブル RLS有効・anon向けポリシー0件で、アクセスは
  service_role のみ。**テナント分離はアプリ層の責任**で、各APIが `company_id` で
  絞ることで担保している。`scripts/tenant_isolation_test.ts` が
  `src/app/api/admin/**` を静的検査し、`company_id` がセッション由来(`ctx.companyId`)
  でないと落ちる。リクエスト由来の `company_id` は絶対に使わない。
- **同じメールが複数の会社に管理者として存在しうる**(`unique(company_id, email)`)。
  `admins` をメールだけで1件に絞ってはいけない(`maybeSingle` は該当2件以上でエラー)。
- 認証の実装は `src/lib/` の `password` / `password-policy` / `totp` /
  `tenant-session` / `trusted-device` に集約。判定は純粋関数にして
  `scripts/*_selftest.ts` でテストする方針。
- パスワードは12文字以上・英字/数字/記号。判定は `checkPassword` 一箇所で、
  画面とAPIの両方から同じ関数を呼ぶ。
- 「7日間ログインしたままにする」は署名Cookie。`password_hash` と `totp_secret`
  から作った指紋を埋めてあり、**どちらかが変わると記憶が全て失効する**。

## コマンド

```
npm test        # tsc + 各 selftest（純粋関数のテスト群）
npm run build   # 本番ビルド
npx tsc --noEmit
npx eslint      # 0 errors を維持する。warning は既存分あり
```

## デプロイとマイグレーション

- `main` にマージ → Vercel が自動デプロイ
- `db/migrations/*.sql` が `main` に入る → GitHub Actions「DB Migrate」が自動適用
- **データ操作(パスワード再設定など)はマイグレーションに書かない。**
  リポジトリに永久に残るため。運営画面の機能か、Supabase の SQL Editor で行う

## 変更時の作法

- 動作確認は実ブラウザ(Chromium + Playwright)まで行う。`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
- ロジックは純粋関数に切り出し、`scripts/` に selftest を足して `npm test` に登録する
  （`package.json` の test 文字列に追記。名前の部分一致に注意）
- 顧客に渡す資料は `らくらく勤怠/sales/`、社内手順は `らくらく勤怠/specs/`。
  実装を変えたらこちらも直す
