# Phase A：派遣モデルの共通土台（単発＋中長期）設計書

> 目的：単発・中長期を「別プロダクト」ではなく**1つの共通データモデル**で扱えるようにする。
> Phase A はスキーマの土台だけ。集計/給与（Phase B）・派遣法コンプラ（Phase C）は後続。
> ※実装（アプリ側）に着手する前に、`node_modules/next/dist/docs` を読むこと（本プロジェクトのNext.jsは破壊的変更あり／AGENTS.md）。

## 1. 設計思想

単発と中長期の違いは「**期間とシフトの有無**」だけ。単発＝中長期の特殊ケース（1回きり）として同じ仕組みに乗せる。

```
companies(派遣元/テナント)
   └ clients(派遣先) ── assignments(契約/アサイン) ── shifts(シフト) ── attendance(打刻)
                              ├ type='spot'    … 単発（1日・1シフト）
                              └ type='ongoing' … 中長期（期間・複数シフト・月次集計）
```

## 2. 追加テーブル

### clients（派遣先）
| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK→companies | テナント |
| name | text not null | 派遣先企業名 |
| workplace_name | text | 就業場所名 |
| address | text | |
| contact_name / contact_phone | text | 担当者 |
| teishokubi | date NULL | 抵触日（Phase Cで使用。今はnull可） |
| created_at / updated_at | timestamptz | |

### assignments（契約/アサイン）
| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK→companies | |
| user_id | text FK→user_profiles | スタッフ |
| client_id | uuid FK→clients | |
| type | text check('spot','ongoing') | 単発/中長期 |
| start_date | date not null | |
| end_date | date NULL | null=当日単発 or 期間未定 |
| job_content | text | 業務内容 |
| hourly_rate | integer NULL | 時給（円） |
| status | text check('planned','active','ended') default 'active' | |
| created_at / updated_at | timestamptz | |

### shifts（シフト）
| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK→companies | |
| assignment_id | uuid FK→assignments | |
| work_date | date not null | |
| start_time / end_time | time | 予定 |
| break_minutes | integer default 0 | |
| status | text check('planned','confirmed','done','absent') default 'planned' | |
| created_at / updated_at | timestamptz | |

単発＝assignmentに shift 1件。中長期＝shift 複数件（シフト表）。

### attendance（既存テーブルに列追加・非破壊）
```sql
alter table attendance add column if not exists shift_id uuid;       -- どのシフトの打刻か
alter table attendance add column if not exists assignment_id uuid;  -- 集計用に非正規化
```
※既存の打刻を壊さないため **nullable**。既存データはそのまま動く。

## 3. 単発／中長期の使い分け（同じ仕組み）

- **単発**：clients（またはスポット用の汎用派遣先）＋ assignment(type='spot', start=end=当日) ＋ shift 1件。スタッフはそのシフトに対して打刻。
- **中長期**：client（後で抵触日設定）＋ assignment(type='ongoing', 期間) ＋ shift を期間分生成（シフト表）。月次で締めて集計（Phase B）。

## 4. セキュリティ（既存方針を踏襲）
- 全テーブルに **RLS** を有効化し、`company_id = 現在のテナント` でスコープ（既存 companies/admins と同じ流儀）
- 追加FKに `on delete cascade`（テナント削除時の外部キー制約は過去に修正済み。MULTITENANT_FIX_CASCADE.sql 準拠）
- 個人情報の暗号化方針は既存（電話番号暗号化）を踏襲

## 5. マイグレーション方針
- **すべて additive**（create table if not exists / add column if not exists）。既存機能を壊さない
- 既存の単発運用は無変更で継続。派遣先/契約/シフトは「使い始めたら効く」オプトイン
- SQLは `specs/` に新規ファイルで追加（例：`PHASE_A_DISPATCH_MIGRATION.sql`）。既存の SUPABASE_RUN_ALL.sql の流儀に合わせる

## 6. Phase A のスコープ外（後続）
- **Phase B**：月次タイムシート・残業/割増・有給・給与エクスポート・派遣先への勤怠報告・シフト表UI・LINEシフト通知
- **Phase C**：抵触日/3年ルールのアラート・派遣元/派遣先 管理台帳の自動生成（実顧客が必要になってから）

## 7. 承認事項（オーナー確認）
- [ ] このテーブル構成でよいか
- [ ] 単発の汎用派遣先を用意するか（既存の単発運用との互換）
- [ ] Phase A の実装に進んでよいか（マイグレーションSQL＋アプリ側）
