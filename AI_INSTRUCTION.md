# ラクラク勤怠 (rakuraku-kintai) 開発要件

このプロジェクトは、Next.js (App Router), Tailwind CSS, Supabase, LINE LIFF を用いて構築する「非常にシンプルな勤怠管理システム」です。
ユーザー（開発者）からの指示に基づき、Claude Code を用いてコーディングを進めてください。

## 技術スタック
- **フレームワーク**: Next.js (App Router, TypeScript)
- **スタイリング**: Tailwind CSS
- **バックエンド/DB**: Supabase
- **フロントエンド連携**: LINE LIFF
- **アイコン**: lucide-react

## 実装してほしい基本機能
1. **LINE LIFF の初期化とユーザー情報取得**:
   - LIFF SDK を初期化し、LINE アプリ上で開かれた際にユーザーのプロフィール（名前、アイコン画像、ユーザーID）を取得する。
2. **打刻機能（出勤・退勤）**:
   - ホーム画面に「出勤」と「退勤」の大きなボタンを配置する。
   - ボタンが押されたら、現在時刻とユーザーID（LINEのID）を Supabase のテーブルに記録する。
3. **打刻ステータスの表示**:
   - 本日の打刻履歴（出勤時刻、退勤時刻）や現在の状態（出勤中など）を画面上にシンプルに表示する。

## 初期セットアップ済みの内容
- Next.js プロジェクト作成 (`npx create-next-app`)
- `@supabase/supabase-js`, `@line/liff`, `lucide-react` のインストール
- `.env.local` の作成（LIFF ID, Supabase URL / Anon Key のプレースホルダー）

## Claude Code への指示
1. まず、`src/app/layout.tsx` や `src/components/` に LINE LIFF のプロバイダーを実装し、アプリ全体で LIFF 機能を使えるようにしてください。
2. 次に、`src/lib/supabase.ts` を作成し、Supabaseクライアントを初期化してください。
3. その後、`src/app/page.tsx` の UI を実装し、打刻ボタンと Supabase へのデータ保存ロジックを完成させてください。
