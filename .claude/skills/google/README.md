# Google 公式 Agent Skills（vendoring）

このディレクトリは Google 公式リポジトリ [`google/skills`](https://github.com/google/skills)
（Cloud Next 2026 で公開）の Agent Skills をそのまま取り込んだものです。
`npx skills add google/skills` 相当の内容を、この repo にコミットして
チーム全員が Claude Code で使えるようにしています。

## 内訳（計 109 スキル）

| カテゴリ | 数 | 内容 |
|---|---|---|
| `cloud/` | 95 | Google Cloud 全般（Cloud Run / GKE / BigQuery / Firebase / Cloud SQL / Spanner / AlloyDB / Well-Architected 等） |
| `ads/` | 12 | Google Ads API / Mobile Ads SDK / Data Manager API 等 |
| `analytics/` | 2 | Google Analytics Admin / Data API |

各スキルは `<name>/SKILL.md`（＋必要に応じ `references/`）で構成され、
Claude が必要になったときだけ内容を読み込みます（コンテキスト肥大を防ぐ設計）。

## marketplace プラグイン（別チャネル）

`google/skills` にはもう一つ、Google Cloud の DB/データ連携プラグイン
（AlloyDB / BigQuery / Spanner / Cloud SQL 等、MCP サーバー付き）を配布する
marketplace も同梱されています。これはリポジトリ直下の
`.claude/settings.json` の `extraKnownMarketplaces` に `google-plugins` として
登録済みです。個別に使うときは Claude Code で:

```
/plugin            # google-plugins から必要なプラグインを選んで install
# 例: claude plugin install bigquery@google-plugins
```

これらのプラグインは各 Google Cloud サービスへの認証（gcloud 等）が必要なため、
既定では有効化していません（必要なメンバーだけが個別に入れられます）。

## ライセンス

Apache License 2.0（`./LICENSE`）。© Google LLC。
本 repo では改変せず取り込んでいます。更新する場合は
`git clone https://github.com/google/skills` の `skills/` を再取得してください。
