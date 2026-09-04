# ステージング環境：同一Supabaseプロジェクト内・別スキーマ方式

## 背景

Supabaseの無料プランでプロジェクト数上限に達したため、新規プロジェクトを作らずに
検証環境を用意する方法。本番と**同じSupabaseプロジェクト・同じ接続情報**のまま、
Postgresの別スキーマ（`staging`）にテーブル一式を複製する。

- 追加費用ゼロ
- 本番の`public`スキーマとは完全に独立したテーブル（データも別）
- `service_role`キーは本番と共有するため、**接続先の取り違え事故を防ぐ工夫が必須**（後述）

代替案（案B: ローカルSupabase CLI／案C: 別アカウント）と比べたトレードオフ：
- ローカルCLIより実機（スマホ）検証との相性が良い（結局トンネルが要る点は同じだが、
  DB自体はクラウド上にあるので接続情報の管理がシンプル）
- 別アカウントより運用の手間が少ない（同じダッシュボード・同じ請求で完結）
- **デメリット**: 本番と同じプロジェクトなので、Supabase側の障害・メンテナンスの影響を
  本番と一緒に受ける（真の意味での障害分離にはならない）。あくまで無料枠での暫定策。

---

## STEP 1: `staging` スキーマを作成し、テーブル一式を投入（SQL Editor）

1. Supabaseダッシュボード → 対象プロジェクト → **SQL Editor** → New query
2. 以下を**先頭に追記**してから、`db/staging-bootstrap.sql` の中身をそのまま貼り付けて実行

   ```sql
   create schema if not exists staging;
   set search_path to staging;

   -- ここに db/staging-bootstrap.sql の内容をそのまま貼り付ける
   ```

3. 実行後、`db/migrations/0001`〜最新（現時点で`0009`）まで適用する。これはSQL Editorではなく
   ローカルのターミナルから行う（`migrate.mjs`がスキーマ切り替えとファイル管理に対応済み）：

   ```bash
   PG_SCHEMA="staging" DATABASE_URL="<Supabase Settings→Database→Session poolerの接続文字列>" npm run migrate
   ```

   `PG_SCHEMA=staging`を指定すると、`migrate.mjs`が自動的に`set search_path to staging, public`を
   実行してから適用するので、テーブルは全て`staging.*`に作られる。適用済み管理
   （`schema_migrations`テーブル）も`staging`スキーマ内に独立して持つため、本番の適用履歴とは
   混ざらない。

4. `らくらく勤怠/specs/SUPERADMIN_SEED.sql`相当の手順で、**staging用の運営者アカウント**を作成する
   （これも`set search_path to staging;`を先頭に追記してから実行）。

## STEP 2: PostgRESTに `staging` スキーマを公開する

Supabaseの自動生成API（PostgREST、＝`@supabase/supabase-js`が使う経路）は、デフォルトで
`public`スキーマしか外部に見せない。`staging`をAPI経由で読み書きするには明示的な許可が要る。

1. Supabaseダッシュボード → **Settings** → **API**
2. **Exposed schemas** に `staging` を追加（`public`と併記でよい。既存の本番動作に影響しない）
3. 保存

## STEP 3: ローカル環境変数（`.env.local`）

**重要**: `NEXT_PUBLIC_SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`は本番と同じ値を使う。
`SUPABASE_SCHEMA`を追加することで、アプリ全体が`staging`スキーマだけを見るようになる。

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<本番と同じprojectref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<本番と同じservice_roleキー>
SUPABASE_SCHEMA=staging          # ★これが無いと本番のpublicスキーマを見てしまう

SESSION_SECRET=<ローカル専用のランダム32文字以上。本番と共用しない>
NEXT_PUBLIC_LIFF_ID=<開発用LIFFアプリのID>
LINE_CHANNEL_ID=<開発用LIFFアプリのチャネルID>
```

`.env.local`は**絶対にコミットしない**（`.gitignore`済みのはずだが確認すること）。

## STEP 4: 起動して確認

```bash
npm run dev
curl http://localhost:3000/api/health
```

レスポンスの`schema`フィールドが`"staging"`になっていることを確認する
（`/api/health`に今回`schema`フィールドを追加済み）。`"public"`のままなら
環境変数が反映されていない。

```json
{ "ok": true, "db": "up", "env": "local", "project": "xxxx", "schema": "staging", ... }
```

---

## 事故防止のための運用ルール

1. **`SUPABASE_SCHEMA`はVercelの本番(Production)環境変数には絶対に設定しない。**
   Preview環境変数として設定するのは可（PRごとの検証に使う場合）。
2. ローカルで作業する開発者全員が`.env.local`に`SUPABASE_SCHEMA=staging`を入れる運用にする
   （うっかり未設定でローカルから本番`public`を触ってしまう事故を防ぐため）。
3. `/api/health`の`schema`フィールドを、動作確認のたびに目視で確認する癖をつける。
4. **`staging`スキーマのデータは本番の顧客情報を絶対に入れない**（テストデータのみ）。
   個人情報保護の観点で、本番データをコピーしてstagingに入れる運用は避ける。

## いずれ本当のステージング（別プロジェクト）に移行する場合

Supabaseの無料プロジェクト枠が空いた場合、または有料化する場合は、この`staging`スキーマの
テーブル定義（`db/staging-bootstrap.sql` + `db/migrations/*.sql`）をそのまま新プロジェクトの
`public`スキーマに流し込めば移行できる。アプリ側は`SUPABASE_SCHEMA`環境変数を削除するだけで
（デフォルトの`public`扱いに戻るので）新プロジェクトを指す設定に切り替えられる。
