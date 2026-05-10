# LINE LIFF セットアップガイド

## 概要

このガイドに従うことで、「ラクラク勤怠」をLINEアプリ内で動作させることができます。

---

## Step 1: LINE Developers でチャンネルを作成

1. [LINE Developers](https://developers.line.biz/) にログイン
2. 「プロバイダー」を作成（まだない場合）
3. 「チャンネルを作成」→「LINEログイン」を選択
4. チャンネル名: `ラクラク勤怠`
5. チャンネルの種類: `ウェブアプリ`

---

## Step 2: LIFF アプリを登録

1. 作成したチャンネルの「LIFF」タブを開く
2. 「追加」をクリック
3. 以下を設定:

| 項目 | 値 |
|---|---|
| LIFFアプリ名 | ラクラク勤怠 |
| サイズ | Full |
| エンドポイントURL | `https://あなたのドメイン.vercel.app`（Vercelデプロイ後） or ngrokのURL |
| Scope | `profile`, `openid` にチェック |
| ボットリンク機能 | Off でOK |

4. 「追加」を押すと **LIFF ID** が発行される（例: `1234567890-abcdefgh`）

---

## Step 3: .env.local を更新

```
NEXT_PUBLIC_LIFF_ID="発行されたLIFF ID"
```

---

## Step 4: ローカル開発でテストする場合（ngrok使用）

```bash
# ngrokをインストール後
ngrok http 3000
```

発行された `https://xxxx.ngrok.io` を LIFF のエンドポイントURLに設定する。

---

## Step 5: Vercel に本番デプロイ

```bash
npx vercel
```

デプロイされたURL（例: `https://rakuraku-kintai.vercel.app`）をLIFFのエンドポイントURLに設定。

Vercel の Environment Variables にも以下を追加:
- `NEXT_PUBLIC_LIFF_ID`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 現在の状態

- ✅ Supabase 接続済み
- ✅ デモモードで動作確認済み（ブラウザ）
- ⏳ LIFF ID 未設定（LINE上での動作にはStep 1〜3が必要）
