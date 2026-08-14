# Google 公式 Agent Skills（マーケ用途のみ抜粋）

このディレクトリは Google 公式リポジトリ [`google/skills`](https://github.com/google/skills)
（Apache-2.0）から、**ラクラク勤怠のマーケティング業務で活きるものだけ**を抜粋して
取り込んだものです。

当初は全109スキルを取り込みましたが、本プロジェクトは
**Next.js / Supabase / Vercel** 構成で Google Cloud（GCP）を使っていないため、
GCP インフラ系スキル（GKE・BigQuery・Cloud Run・各種DB連携プラグイン等）は撤去しました。
Google アカウント（Drive 等）を活かす用途は、別途 `../google-drive/` の自作スキルが担います。

## 残しているスキル（計 8）

### `analytics/` — サイト/LP アクセス解析（2）
| スキル | 用途 |
|---|---|
| `google-analytics-admin-api-basics` | GA4 のアカウント・プロパティ設定管理 |
| `google-analytics-data-api-basics` | GA4 のレポートデータ取得・レポート生成 |

### `ads/` — 広告運用・コンバージョン計測（6）
| スキル | 用途 |
|---|---|
| `google-ads-api-account-diagnostics` | 広告アカウントの不調（CV減・リード不足・impression損失）を診断 |
| `google-ads-api-quickstart` | Google Ads API のセットアップ入門 |
| `google-ads-api-mcp-setup` | 公式 Google Ads MCP サーバーの導入 |
| `data-manager-api-setup` | Data Manager API のクライアント/認証セットアップ |
| `data-manager-api-event-ingestion` | コンバージョン・イベントを Google 広告へ連携 |
| `data-manager-api-audience-ingestion` | オーディエンス（顧客リスト）を Google 広告へ連携 |

> これらは無料の GA / 別途契約の Google Ads が前提です（Google One とは別サービス）。
> `marketing-writer`（ソラ）と組み合わせて集客・効果測定に使えます。

## ライセンス

Apache License 2.0（`./LICENSE`）。© Google LLC。無改変で取り込み。
更新する場合は `git clone https://github.com/google/skills` の該当フォルダを再取得してください。
