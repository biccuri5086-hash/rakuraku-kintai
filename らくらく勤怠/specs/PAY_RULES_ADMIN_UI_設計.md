# pay_rules 管理画面 設計・実装メモ

対象: `/admin/pay-rules` ＋ `/api/admin/pay-rules/**` ／ 関連マイグレーション `0009_pay_rule_schedule_fn.sql`

## 何のためか

`pay_rules`（会社/派遣先/契約の3スコープ×有効期間で賃率を版管理するテーブル）はDB設計のみ先行しており、管理画面から操作する手段が無かった。本実装でAPI・UIを追加した。

## 設計の要点

- **改定は追記のみ**。既存ルールをUPDATEで書き換える経路はUIにもAPIにも存在しない。「改定を予約」すると、今開いている行(`effective_to is null`)を自動で閉じ、新しい行をINSERTする。両方とも `fn_schedule_pay_rule`（Postgres関数）内で1トランザクションとして行う。
- **開始済み・過去の行はUIから編集不可**（表示のみ）。「予約中」（`effective_from`が未来）の行だけ取消できる。取消時は `fn_cancel_pay_rule` が「この予約が閉じた直前の行」を再オープンし、空白期間を作らない。
- **継承チェーンの可視化**: `resolvePayRuleChain`（`src/lib/payroll/payRules.ts`）が company/client/assignment それぞれの該当ルールと勝者を返す。管理画面はこれをそのまま表示に使う。`resolveDayRate`（給与計算本体）と勝敗ロジックを共有しているため、画面表示と実際の給与計算がずれない。
- **「行全体で勝敗が決まる」設計の罠への対策**: `pay_rules`はフィールド単位のマージではなく、勝ったスコープの行がまるごと適用される。時給だけ変えたい場合でも割増率を空にすると company の割増率にはフォールバックしない（assignment側は`assignments.hourly_rate`にしかフォールバックしない）。これを防ぐため、「改定を予約」フォームは**常に現在有効な値を全項目にプリフィル**する。
- **プレビュー→確認→確定の2段階フロー**: `POST /preview`は書き込みを一切行わず、50%以上のレート変動があれば`needsConfirmation:true`を返す。確定は`POST /schedule`に`previewToken`（HMAC署名・TTL10分）を渡すだけで、フロントから再送された数値そのものは信用しない。
- **過去日付への遡及編集は禁止**（開始日は今日以降のみ）。確定済み給与(`timesheet_entries`)は確定時点のレートをスナップショット済みなので遡及編集自体は実害が無いが、労務上の紛らわしさを避けるため許可していない。

## 実装ファイル

| 種別 | パス |
|---|---|
| 純粋関数（検証） | `src/lib/payroll/payRuleValidation.ts` |
| 純粋関数（継承チェーン） | `src/lib/payroll/payRules.ts` の `resolvePayRuleChain` |
| DBヘルパー | `src/lib/payroll/payRuleAdmin.ts` |
| 署名トークン | `src/lib/payRuleToken.ts` |
| API | `src/app/api/admin/pay-rules/{route,effective,preview,schedule,[id]}.ts` |
| UI | `src/app/admin/pay-rules/page.tsx` |
| マイグレーション | `db/migrations/0009_pay_rule_schedule_fn.sql`（`fn_schedule_pay_rule` / `fn_cancel_pay_rule`） |
| テスト | `scripts/pay_rule_validation_selftest.ts` |

## 未対応・今後の課題

- 最低賃金との自動照合は未実装（時給の妥当性チェックは単純なレンジ(100〜100,000円)のみ）。
- `/admin/assignments`・`/admin/clients` からの直接リンク（埋め込み到達）は未実装。現状は `/admin/pay-rules` 側でスコープ・対象を選ぶ導線のみ。
- 実際のSupabase接続を伴うブラウザでの動作確認は、この開発環境に接続情報が無いため未実施。型チェック・ビルド・selftestのみで検証している。ステージング環境での確認を推奨。
