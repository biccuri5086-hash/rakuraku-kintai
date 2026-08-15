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

### 3.1 休日の判定（モード切替・負担最小）

割増は「その日が休みか」ではなく **法定休日労働（1.35）か／時間外（1.25）か** で決まる。
会社ごとに **休日モード** を切り替える。**スタッフは休日を入力しない**（シフトの有無で判定）。

**モードA：`weekly_fixed`（曜日固定・土日休み等）**
- 所定休日＝ `prescribed_off_dows`（複数曜日）／法定休日＝ `statutory_holiday_dow`（既定：日曜）
- その曜日に勤務 → 法定休日なら 1.35、所定休日なら時間外(1.25/40h超)

**モードB：`shift`（シフト休み・サービス業向け）**
- 所定休日＝**シフト未割当日（自動）**。スタッフ・管理者とも休日入力不要＝負担ゼロ
- 法定休日の判定は次の2方式から会社が選ぶ（`shift_statutory_rule`）：
  - `weekly_auto`（推奨・既定）：週（`week_start` 起算）の中で1日も休みが無ければ、その週の**7日目の勤務を法定休日労働(1.35)**とみなす。休みが1日でもあれば超過分は時間外(1.25)
  - `fixed_dow`（簡易）：法定休日の曜日を1つだけ固定指定（`statutory_holiday_dow`）
- どちらも**日々の休日指定は発生しない**（システムがシフトから自動算出）

---

## 4. データモデル追加案（すべて additive・未実行）

> 既存を壊さない（`create table/add column if not exists`）。実行は承認＋ダブルチェック後。

### 4.1 `company_payroll_settings`（会社ごとの集計ルール・**管理者が設定**）
| 列 | 型 | 用途 |
|---|---|---|
| company_id | uuid PK FK | テナント |
| closing_day | int | **締め日（管理者設定）**。末日=31, 20日締=20 |
| week_start | int default 1 | 週の起算（1=月） |
| **holiday_mode** | text default 'weekly_fixed' | `weekly_fixed` / `shift` |
| prescribed_off_dows | int[] | 所定休日の曜日（weekly_fixed用。例 {0,6}=日土） |
| statutory_holiday_dow | int default 0 | 法定休日の曜日（0=日）。weekly_fixed／shiftのfixed_dowで使用 |
| shift_statutory_rule | text default 'weekly_auto' | shift時の法定休日判定：`weekly_auto` / `fixed_dow` |
| **round_unit_min** | int default 1 | 端数丸め単位。**1 / 5 / 15 / 60 のみ許可**（check制約） |
| round_scope | text default 'month' | 丸め適用範囲（**month推奨**。dayは非推奨） |
| round_mode | text default 'up' | up / nearest（**down一方向は避ける**） |
| overtime_rate | numeric default 1.25 | 法定外割増 |
| night_rate | numeric default 1.25 | 深夜割増 |
| holiday_rate | numeric default 1.35 | 法定休日割増 |
| deemed_break_json | jsonb | 実働Nhで自動M分休憩などの規定 |

> 丸めは労基法上「日ごと切り捨て」が賃金未払いリスク。既定は **1分集計 → 月合計に対して丸め（切上/四捨五入）**。

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

> **方針（確定）：フル給与計算ソフトは作らない。** 勤怠を締めて「実働・残業・深夜・休日の時間」を確定し、
> 既存の給与ソフト（freee/マネフォ/奉行 等）に**渡す（連携）**に徹する。社会保険・源泉・住民税・年末調整・
> 振込は作らない（法対応の維持コスト・リスクが本業から外れるため）。
> 折衷として **概算給与額（時給×実働＋割増）** は管理者の確認用に表示する（正式な給与明細ではない）。
>
> **給与ソフトに繋ぎやすい形（確定）**：エクスポートは「1行＝スタッフ×対象月」の集計行を基本に、
> 列を給与ソフトの取込項目に素直にマッピングできる構成にする（余計な結合不要）。加えて日次明細も
> 別CSVで出せるようにし、`timesheet_entries` を素直にフラット化する。文字コード/区切りは取込先に
> 合わせて選択可（UTF-8/Shift_JIS・カンマ）。

**集計の基準（確定）**：給与集計・休日判定は **実際の打刻（attendance）を基準に自動算出**する。
そのためシフトの登録頻度（**月1回でも可**）に依存せず締めが成立する。シフトは打刻漏れ検出・
派遣先報告・週次休日判定の精度向上に使う（スタッフの休日申告は不要）。

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

## 8. 実装フェーズ分割と進捗

| 小Phase | 内容 | 状態 |
|---|---|---|
| B-1 | 集計基盤：打刻ペアリング＋時間区分（`src/lib/payroll/`）／自己テスト | ✅ 実装・検証済 |
| B-2 | 月次締めプレビュー＋確定UI（`/admin/payroll`、confirm API） | ✅ 実装済（確定保存はDB適用後に有効） |
| B-3 | 給与エクスポート（汎用CSV・繋ぎやすい列）＋監査ログ | ✅ 実装済（監査ログはDB適用後に記録） |
| B-4 | 派遣先勤怠報告（`/admin/client-report`） | ✅ 実装済 |
| 設定 | 会社別設定 UI/API（`/admin/payroll/settings`） | ✅ 実装済（保存はDB適用後に有効） |

**適用後にやること（＝これだけ）**
1. Supabase 手動バックアップ → SQL Editor で `PHASE_B_MIGRATION.sql` を実行（ハヤト/ノア承認済み）
2. `/admin/payroll/settings` で会社の締め日・割増・休日モード等を保存
3. 各月を `/admin/payroll` で「締める（確定）」

適用前は、読み取り（プレビュー・派遣先報告・CSV）はデフォルト設定で**そのまま動作**。
書き込み（設定保存・締め確定）は「テーブル適用が必要」の明示メッセージを返す。コード変更は不要。

---

## 9. オーナー確定事項

**すべて確定（2026-08-14）**
- ✅ **締め日**：管理者が会社ごとに設定可能（`closing_day`）
- ✅ **休日**：`weekly_fixed`（土日等）を既定に、`shift`（シフト休み）へ切替可。スタッフは休日入力しない
- ✅ **shift時の法定休日判定**：`weekly_auto`（週次自動）を既定
- ✅ **割増率**：法定外 1.25 / 深夜 1.25 / 法定休日 1.35（会社別に変更可）
- ✅ **みなし休憩**：実働 6h超→45分／8h超→60分を自動控除（会社別に変更可、`deemed_break_json`）
- ✅ **打刻漏れ**：**管理者確認必須**。未解決の日は締め対象外＋フラグ表示（自動補完しない）
- ✅ **丸め単位**：1 / 5 / 15 / 60 分。1分集計→月合計に丸め（切上/四捨五入）を既定
- ✅ **給与ソフト**：自作せず連携（まず汎用CSV・繋ぎやすい列設計）。概算給与は表示、正式計算はしない
- ✅ **集計基準**：実打刻ベース。シフトは月1回登録で可

→ 要件確定。次は **B-1 マイグレーション案（additive・未実行）** を作成し、**ハヤト／ノアのダブルチェック**へ。
   実行（Supabaseへの適用）はオーナーが承認後に行う（rules.md Rule 1）。
