# Phase B：給与エクスポート／派遣先勤怠報告 要件定義（たたき台）

> 位置づけ：`MOAT_ROADMAP.md` の最優先の堀＝**スイッチングコスト**。勤怠を「給与計算と派遣先報告の起点」に
> することで乗り換えを困難にする。本質価値「派遣社員の離職防止」（rules.md Rule 4）を損なわない範囲で設計。
>
> ⚠️ 本ファイルは**要件・設計のたたき台**。DBマイグレーション・実装・外部公開は rules.md Rule 1 により
> オーナー承認を経て着手し、DB変更は**ハヤト（監査）・ノア（統制）のダブルチェック必須**。
> 実装着手時は AGENTS.md に従い `node_modules/next/dist/docs` を読んでから書く。

最終更新: 2026-08-14 ／ 担当: カイ（実装）＋CTO

---

## 1. ゴールと非ゴール

**ゴール**
- 月次の勤怠を締めて、**給与計算用データ**と**派遣先向け就業実績報告**を出力できる。
- 単発（spot）・中長期（ongoing）を同一の仕組みで集計する（Phase A の共通土台を利用）。

**非ゴール（Phase B では扱わない）**
- 給与額そのものの確定計算（社会保険・税・控除）。あくまで**勤怠実績と時間集計**まで。
- 抵触日・3年ルール等の派遣法コンプラ → Phase C。

---

## 2. 既存スキーマの前提（確認済み）

| テーブル | Phase Bで使う要点 |
|---|---|
| `attendance` | **イベント型**：`type`(clock_in/clock_out)・`timestamp`・`company_id`・`shift_id`・`assignment_id`(nullable)。実働時間は打刻ペアから算出する |
| `shifts` | `work_date`・`start_time`・`end_time`・`break_minutes`・`status`(planned/confirmed/done/absent) |
| `assignments` | `type`(spot/ongoing)・`hourly_rate`・`client_id`・`user_id` |
| `clients` | 派遣先（報告書の宛先単位） |
| `user_profiles` | `user_id`・`display_name`・`phone`(暗号化対象) |

RLS 方針：全テーブル service_role のみ（Next.js サーバー経由）。フロントから直接DBアクセス不可。

---

## 3. 核心：打刻（イベント）→ 実働時間の算出

`attendance` は clock_in / clock_out の**イベント列**なので、日・シフト単位でペアリングして実働時間を出す。

**基本式**
```
実働分 = Σ(clock_out - clock_in の各ペア) − 休憩(break_minutes)
```

**必ず扱うエッジケース（要ルール確定）**
1. **打刻漏れ**（clock_out 無し）：予定 `shift.end_time` で補完 or 「要確認」フラグで締め対象外にする（推奨：後者＝管理者確認）
2. **日跨ぎ勤務**（22:00→翌6:00）：`work_date` は開始日基準。深夜帯を跨ぐ
3. **複数ペア**（中抜け・休憩で複数回打刻）：ペアを合算
4. **順序不正**（out が in より前／重複 in）：異常として除外＋フラグ
5. **shift 未紐付けの打刻**（`shift_id` null の既存・単発運用）：`work_date`＋`user_id` で日次集計にフォールバック

**時間区分（割増の前提。%はオーナー確定事項）**
- 法定内 / 法定外残業（日8h・週40h 超）
- 深夜（22:00–5:00）割増
- 休日（法定休日）割増
> ※ 割増率・週の起算曜日・端数丸めは会社設定（下記 `company_payroll_settings`）で持つ。

---

## 4. データモデル追加案（すべて additive・未実行）

> 既存を壊さない（`create table/add column if not exists`）。実行は承認＋ダブルチェック後。

### 4.1 `company_payroll_settings`（会社ごとの集計ルール）
| 列 | 型 | 用途 |
|---|---|---|
| company_id | uuid PK FK | テナント |
| closing_day | int | 締め日（例：末日=31, 20日締=20） |
| week_start | int default 1 | 週の起算（1=月） |
| round_unit_min | int default 1 | 端数丸め単位（分） |
| round_mode | text | up/down/nearest |
| overtime_rate | numeric default 1.25 | 法定外割増 |
| night_rate | numeric default 1.25 | 深夜割増 |
| holiday_rate | numeric default 1.35 | 休日割増 |
| deemed_break_json | jsonb | 実働Nhで自動M分休憩などの規定 |

### 4.2 `timesheets`（月次締めヘッダ：ユーザー×月）
| 列 | 型 | 用途 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK | テナント |
| user_id | text FK | スタッフ |
| period_ym | text | 対象年月 'YYYY-MM'（締め日で区切る） |
| work_min / overtime_min / night_min / holiday_min | int | 集計結果 |
| status | text | draft / confirmed |
| confirmed_at / confirmed_by | timestamptz / text | 締め操作 |
| unique(company_id, user_id, period_ym) | | 二重締め防止 |

### 4.3 `timesheet_entries`（日次明細：締めの内訳・監査用）
| 列 | 型 |
|---|---|
| id / timesheet_id FK / company_id | uuid |
| work_date | date |
| assignment_id / client_id / shift_id | uuid（実績の紐付け） |
| in_at / out_at | timestamptz（採用したペア） |
| work_min / overtime_min / night_min / holiday_min | int |
| flags | text[]（打刻漏れ・要確認 等） |

### 4.4 `payroll_exports`（エクスポート監査ログ）
| 列 | 型 | 用途 |
|---|---|---|
| id / company_id | uuid | |
| period_ym | text | |
| format | text | csv_generic / freee / mfc / obic 等 |
| row_count | int | |
| created_by / created_at | text / timestamptz | 誰がいつ出したか（監査） |

RLS：4テーブルとも service_role のみ（既存踏襲）。`updated_at` トリガーは既存 `trigger_set_updated_at()` を流用。

---

## 5. 出力仕様

### 5.1 給与エクスポート（CSV）
- **汎用CSV**（まず最優先）：`スタッフID, 氏名, 対象年月, 実働時間, 法定外残業, 深夜, 休日, 時給, 派遣先` 等
- **給与ソフト別フォーマット**：freee人事労務 / マネーフォワード / 給与奉行 のいずれかにマッピング（対象はオーナー確定）
- 個人情報保護：**電話番号など不要な個人情報は出力に含めない**。氏名は必要最小限
- 出力操作は `payroll_exports` に必ず記録（監査）

### 5.2 派遣先向け勤怠報告
- `clients`（派遣先）×期間で就業実績を帳票化（誰が・どの日・何時間）
- 形式：CSV ＋ 将来的にPDF帳票
- 派遣先ごとに `assignments.client_id` でスコープ（他社・他派遣先が混ざらない）

---

## 6. UI / API（App Router）

- **管理画面（admin）**：月次締め画面
  - 一覧：スタッフ×日の実働・フラグ（打刻漏れ等）を表示
  - 「確定（confirm）」で `timesheets.status=confirmed`、`shifts.status=done`
  - 「エクスポート」ボタン（CSV / 派遣先報告）
- **API**（`src/app/api/...`、service_role でサーバー集計）
  - `POST /api/timesheets/aggregate`（期間指定で集計→ draft 作成）
  - `POST /api/timesheets/confirm`
  - `GET  /api/timesheets/export?format=...`
  - `GET  /api/reports/client?client_id=...&period=...`
> 実装前に `node_modules/next/dist/docs` の該当ガイドを読む（AGENTS.md）。集計は必ずサーバー側。

---

## 7. セキュリティ要件（ハヤト／ノア確認事項）

- 全新規テーブルに RLS（service_role のみ）、`company_id` スコープ徹底
- エクスポートは個人情報最小化（電話番号を出さない）、操作を監査ログ化
- マイグレーションは additive・非破壊。実行前に Supabase 手動バックアップ
- 破壊的変更・service_role 直書きは ノア の事前承認

---

## 8. 実装フェーズ分割（提案）

| 小Phase | 内容 | 依存 |
|---|---|---|
| B-1 | 集計基盤：打刻ペアリング＋時間区分ロジック（サーバー）／`timesheet*` テーブル | 承認＋DB |
| B-2 | 月次締めUI（一覧・フラグ・confirm） | B-1 |
| B-3 | 給与エクスポート（汎用CSV→給与ソフト別） | B-1 |
| B-4 | 派遣先勤怠報告 | B-1 |

---

## 9. オーナー確定事項（実装前に決める）

1. **締め日**（末日／20日 など）と週の起算曜日
2. **割増率**（法定外・深夜・休日）と端数丸めルール
3. **打刻漏れの扱い**：予定で補完 or 管理者確認必須（推奨：確認必須）
4. **対象の給与ソフト**（汎用CSVのみ／freee／MF／奉行 …）
5. **みなし休憩**の規定有無

上記が固まり次第、B-1 の設計レビュー → マイグレーション案を ハヤト／ノア に回す。
