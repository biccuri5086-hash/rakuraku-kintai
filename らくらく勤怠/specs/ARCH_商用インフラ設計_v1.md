# 商用化アーキテクチャ設計 v1
## スパイク対策 / データ保護 / 派遣スキーマ / インフラ維持費

対象リポジトリ: `rakuraku-kintai`（Next.js 16 / Vercel `hnd1` / Supabase / LINE LIFF）
作成日: 2026-09-03 ／ 前提コミット: `e5d2d93`

金額は 2026 年時点の各社公開価格からの概算。契約前に必ず最新の料金ページで再確認すること。
円換算は $1 = 155円 で計算している。

---

## 0. 現状サマリ（何ができていて、何が無いか）

| 課題 | 現状 | 判定 |
|---|---|---|
| 1. スパイク対策 | 打刻は完全同期。1打刻で Supabase REST 往復 **5回**。キュー無し・冪等キー無し・打刻APIにレートリミット無し | ❌ 未対応 |
| 2. バックアップ | PITR 設定・`pg_dump` 退避・リストア手順・リストア演習のいずれもリポジトリに無い。Sentry と `/api/health` のみ | ❌ 未対応 |
| 3-a. 直行直帰（勤務地紐付け） | `attendance.shift_id / assignment_id` は**列だけ存在**し、`/api/me/clock` は書いていない → 「今日どこで働いたか」がデータ上不明 | ❌ 未対応 |
| 3-b. 派遣先ごとの時給 | `assignments.hourly_rate` はあるが、給与計算は `user_id` ごとに **最新1件の時給だけ**を採用（`payroll/preview` `payroll/confirm`）→ 掛け持ち月は片方の時給で全時間を計算 | ⚠️ 実装バグ |
| 3-c. 派遣先ごとの残業ルール | `company_payroll_settings` は `company_id` が PK。**会社単位のルールしか持てない** | ❌ 未対応 |
| 3-d. GPS偽装防止 | `/api/me/gps` はクライアント申告の緯度経度をそのまま `update`。打刻とは別リクエストで、**送らなくても打刻は成立**。ジオフェンス判定・偽装検知ゼロ | ❌ 未対応 |
| 4. 維持費 | 現状は Vercel + Supabase + Sentry の最小構成。商用要件を満たすと **約 $210〜250/月** に増える（後述） | — |

### すでにできていること（土台としては良い）
- `vercel.json` の `regions: ["hnd1"]` 固定 → Supabase 東京リージョンとの往復が短い
- Sentry 導入済み（server / edge / client）、`/api/health` で DB 到達性を返す
- テナント分離をアプリ層で担保し、`scripts/tenant_isolation_test.ts` で静的検査
- RLS 有効・ポリシー0件（service_role のみ）という明確な方針
- CSP / HSTS / frame-ancestors / API `no-store` などのヘッダ
- 管理者ログインのレートリミット・監査ログ・2FA・信頼済み端末
- 丸め／割増の判定を純粋関数に切り出して selftest 済み

---

## 1. スパイク対策と非同期処理

### 1-1. まず前提の訂正：枯渇するのは「Postgres コネクション」ではない

`src/lib/supabase-admin.ts` は `@supabase/supabase-js` を使っている。これは **PostgREST への HTTPS リクエスト**であって、サーバーレス関数が Postgres の接続を1本ずつ掴むわけではない。
したがって「Lambda が接続を食い潰す」古典的なコネクション枯渇は起きない。実際に先に飽和するのは次の3つ:

1. **PostgREST 内部のDBプール**（compute サイズに比例。Micro/Small では数十本）
2. **DB インスタンスの CPU**（Micro = 共有2vCPU/1GB）
3. **Vercel の同時実行数**（1打刻が 5往復ぶんの待ち時間を占有する）

対策の主眼は「接続数を減らす」ではなく **「1打刻あたりのDB往復回数を減らす」＋「ピークを時間方向にならす」** になる。

### 1-2. 現状の打刻1回のコスト

```
POST /api/me/clock
  ① SELECT user_profiles      (company_id 取得)
  ② SELECT attendance         (直近72h・10件。セッション判定用)
  ③ INSERT attendance
  ④ INSERT admin_audit_log    (logAudit、await している)
POST /api/me/gps
  ⑤ UPDATE attendance         (lat/lng/accuracy)
                                       ────────── 計 5 往復
（＋ me_session Cookie 失効時は api.line.me へ 1回。30分キャッシュあり）
```

**試算（スタッフ3,000人）**: 9:00±3分に集中し、うち半数がピーク60秒に入ると仮定
→ 1,500打刻/分 = 25打刻/秒 = **125 PostgREST req/秒**。
1打刻のレイテンシは 5往復 × 30〜60ms = **150〜300ms**、これが Vercel の同時実行を占有する。
Micro/Small compute では PostgREST のプール待ちが発生し、遅延 → LIFF 側リトライ → さらに負荷、という悪循環に入る。

さらに現状は **冪等キーが無い**ため、リトライやボタン連打が二重打刻になる。`/api/me/clock` にレートリミットも無い（`checkRateLimit` はログインでしか使っていない）。

### 1-3. 目標アーキテクチャ

```
                      [LINE LIFF アプリ]
                       punch_id を端末で採番（冪等キー）
                       GPS も同一リクエストに同梱
                              │  POST /api/me/clock
                              │  {punch_id, type, lat, lng, accuracy, captured_at}
                              ▼
        ┌─────────────────────────────────────────────┐
        │  Vercel Function (hnd1)  受付だけを行う      │
        │  1) me_session Cookie の HMAC 検証（DB不要） │
        │  2) レートリミット（Redis、10req/分/user）   │
        │  3) Redis Lua を1回実行（原子的に）:         │
        │     - idem:{punch_id} SET NX  → 既存なら即200│
        │     - state:{user_id} を読み canPunch 判定   │
        │     - state 更新 + XADD punches …           │
        │  4) 202 Accepted を返す（UIは即「出勤」表示）│
        └───────────────┬─────────────────────────────┘
                        │ Redis 往復 1 回のみ（DB往復 0）
                        ▼
        ┌─────────────────────────────────────────────┐
        │  Upstash Redis                              │
        │   Stream  punches           （キュー本体）   │
        │   Hash    state:{user_id}   （TTL 72h）      │
        │   Stream  punches:dlq       （失敗の隔離）   │
        └───────────────┬─────────────────────────────┘
                        │ XREADGROUP（最大500件）
                        ▼  ← QStash schedule が 10〜60秒ごとに叩く
        ┌─────────────────────────────────────────────┐
        │  POST /api/internal/drain （QStash署名検証） │
        │   - 500件を 1回の bulk upsert に束ねる       │
        │     on_conflict=punch_id → 重複は無視        │
        │   - 監査ログも同様にバッチ INSERT            │
        │   - 成功したら XACK。失敗は再配信、5回で DLQ │
        └───────────────┬─────────────────────────────┘
                        ▼
                   [ Supabase Postgres ]
                    attendance / admin_audit_log

  読み取り経路:
    /api/me/today        → Redis の state:{user_id} を見る（DB往復 0）
    /admin/**（管理画面） → Postgres を見る（最大60秒の遅延を UI に明示）
```

**効果**: 3,000打刻 = DB 書き込み **6〜10回**（従来 15,000回）。
打刻APIのレイテンシは Redis 1往復 = 10〜20ms。Vercel の同時実行占有も 1/10 以下。

### 1-4. データフローの詳細ロジック

**エンキュー（`/api/me/clock`）**
1. `punch_id` は **端末側で採番**（`crypto.randomUUID()`）。ネットワーク再送・連打・LIFF WebView の再実行でも同じ ID になり、必ず1件に収束する。
2. `company_id` は打刻のたびに引かない。`me_session` Cookie（署名付き）に `company_id` を含めて 30分キャッシュする → **①の往復が消える**。
3. 出退勤の妥当性判定（`canPunch`）は Redis の `state:{user_id}` に対して行う。state が無ければ（初回・TTL切れ・Redis再作成）DB から72時間分を読んで再構築し、以後は Redis で完結 → **②の往復が消える**。
4. Redis 操作は Lua スクリプト1本に閉じて原子的に行う。二重打刻の判定とエンキューの間に競合が入らない。
5. レスポンスは `202 { punchId, state }`。UI は楽観的に「出勤しました」を表示する。

**ドレイン（`/api/internal/drain`）**
- QStash の schedule から呼ぶ（署名検証必須。誰でも叩けるエンドポイントにしない）。
- 平常時は毎分、7:00〜10:00 / 17:00〜21:00 のピーク帯は 10〜20 秒間隔。
- `XREADGROUP` で最大500件 → 配列 INSERT を1リクエストで送る。`punch_id` に UNIQUE 制約を張り `on_conflict` で無視 → **at-least-once 配信でも DB は正しくなる**（冪等）。
- 成功したら `XACK`。例外時は ACK しないので自動的に再配信。5回失敗で `punches:dlq` へ移し、Sentry 通知＋運営画面に「未反映打刻 N件」を表示する。

**フォールバック（打刻を絶対に落とさないための設計）**
- Redis がエラー / タイムアウト（>300ms）した場合は、**その場で従来どおり DB に直接 INSERT する**。サーキットブレーカで一定時間は同期モードを維持し、回復したらキューに戻す。
- キューは「速くするための最適化」であって「打刻の成立条件」ではない、という位置づけを守る。

**締め処理との整合（見落としやすい事故ポイント）**
- 給与の月次締め（`/api/admin/payroll/confirm`）の**前に、未処理ストリーム長 = 0 を確認するゲートを必ず置く**。Redis にしか存在しない打刻があるまま締めると、給与が過少になる。
- 管理画面の勤怠一覧にも「最終反映時刻」を表示し、遅延が5分を超えたらアラートを出す。

### 1-5. 段階導入（いきなりフルキューにしない）

| 段階 | 内容 | DB往復/打刻 | 工数目安 |
|---|---|---|---|
| **P0** | GPS を `/api/me/clock` に同梱、`logAudit` を `waitUntil` で非同期化、`punch_id` 冪等キー＋UNIQUE 制約、打刻APIにレートリミット | 5 → 3 | 1日 |
| **P1** | `me_session` に `company_id` を含める、セッション状態を Redis キャッシュ | 3 → 1 | 2〜3日 |
| **P2** | Stream + QStash によるフルキュー化、DLQ、締めゲート | 1 → 0.003 | 1週間 |

**スタッフ数千人規模なら、実は P0 + P1 で十分足りる可能性が高い。**
P2 は「打刻が即座にDBに無い」状態を作り、締め・監査・管理画面すべてに影響する。5,000人超、または複数テナントの始業時刻が同一に重なることが実測で確認できてから入れるのが妥当。

---

## 2. データ保護と障害対応

### 2-1. 現状
リポジトリにバックアップ関連の仕組みは**一つも無い**。Supabase Free プランなら日次バックアップのみ（保持7日・PITR無し）で、**最大24時間ぶんの勤怠が飛ぶ**。給与計算の元データとしては商用で許容できない。

### 2-2. 三層防御

**レイヤ1: Supabase PITR（Pro プラン + PITR アドオン、保持7日）**
- WAL を継続アーカイブし、任意の時点に復元できる。**RPO ≒ 2分**。
- 効くケース: 誤った UPDATE/DELETE、マイグレーション事故、アプリのバグによるデータ破壊。
- 効かないケース: Supabase プロジェクトそのものの消失、アカウント侵害、請求停止による凍結。→ だからレイヤ2が要る。

**レイヤ2: 外部ストレージへの日次論理バックアップ**

```
GitHub Actions（毎日 JST 03:00 / cron: "0 18 * * *" UTC）
  ↓ pg_dump --format=custom --no-owner --no-privileges
  ↓ gzip -9
  ↓ age で暗号化（公開鍵は Secrets、秘密鍵は 1Password 等でオフライン保管）
  ↓ aws s3 cp（S3 互換 API）
Cloudflare R2  バケット: rk-backups/prod/YYYY/MM/DD/dump.age
  世代管理: 日次7 / 週次5 / 月次12（ライフサイクルルールで自動削除）
```

- **なぜ Vercel Cron ではなく GitHub Actions か**: `pg_dump` バイナリが必要で、実行時間もサーバーレス関数の上限（最大300秒）を超えうるため。
- **実務で必ず詰まる点**: Supabase の direct connection は IPv6 のみ。GitHub Actions のランナーは IPv6 非対応なので、**Supavisor の session mode（IPv4）経由**にするか、**IPv4 アドオン（$4/月）**を付ける必要がある。
- **なぜ R2 か**: エグレス無料。リストア時に数GB を引き出しても転送費がかからない。S3 でも可。
- **バックアップ先は Supabase と別ベンダーにする**こと（同一障害・同一アカウント侵害で共倒れしない）。

**レイヤ3: アプリ層の改ざん耐性（バックアップ以上に効く）**
- `attendance` は物理削除禁止（`deleted_at` による論理削除）。
- 管理者による打刻修正は上書きせず、`attendance_corrections`（追記専用）に「誰が・いつ・何を・なぜ」を残す。労基法上の記録保存義務（賃金台帳等5年、当面3年の経過措置）と、後日の労使紛争に耐えるため。
- これは「復旧」ではなく「そもそも壊れた状態を検知・巻き戻せる」ための設計で、優先度は PITR と同等以上。

### 2-3. 復旧できることの検証（ここを飛ばすと全部無意味）
- **月1回のリストア演習を定例化**: 最新 dump を staging プロジェクトに restore →『npm test』→ 管理画面のスモークテスト。結果を `運用手順書_RUNBOOK.md` に追記。
- 復元できないバックアップはバックアップではない。演習していない仕組みは「やった気」にしかならない。

### 2-4. 顧客に約束する SLA（案）
| 指標 | 目標 | 根拠 |
|---|---|---|
| RPO（データ損失許容） | 5分 | PITR の WAL アーカイブ間隔 |
| RTO（復旧目標時間） | 4時間 | PITR 復元 + 検証 + 切替 |
| バックアップ保持 | 日次7 / 週次5 / 月次12 | R2 のライフサイクル |
| 可用性 | 99.5%（月間ダウンタイム約3.6時間） | Vercel/Supabase の SLA を上回る約束はしない |

**注意**: Vercel Pro / Supabase Pro には可用性 SLA が付かない（Enterprise/Team 相当が必要）。上流が保証していない数字を顧客に約束すると契約リスクになる。「ベストエフォート + 上記の復旧目標」として提示する。

### 2-5. 必要プランと費用（データ保護分のみ）
| 項目 | 月額 |
|---|---|
| Supabase Pro | $25（compute $10 クレジット込み） |
| Compute Small（PITR と安定性のため推奨） | $15 − $10 クレジット = $5 |
| PITR アドオン（7日保持） | $100 |
| IPv4 アドオン（GH Actions からの pg_dump 用） | $4 |
| Cloudflare R2（〜50GB） | 約 $1 |
| **小計** | **約 $135/月（約2.1万円）** |

PITR の $100 が重い場合の代替案: **PITR を見送り、pg_dump を 6時間ごとに実行する**（RPO 6時間・費用 $0 追加）。ただし「勤怠データの損失は最大6時間ぶん」を顧客に明示すること。有償サービスとして販売するなら PITR は入れるべき。

---

## 3. 派遣特有のビジネスロジックのスキーマ設計

### 3-1. 現状スキーマの具体的な欠陥

1. **打刻に勤務地が無い**: `/api/me/clock` は `user_id / type / timestamp / company_id` しか入れない。`shift_id` `assignment_id` は列があるだけで NULL のまま。直行直帰では「今日どこで働いたか」が復元できない。
2. **時給がスタッフ単位で解決されている**: `payroll/preview` と `payroll/confirm` は `assignments` を `start_date desc` で走査し、`user_id` ごとに**最初に見つかった時給**を採用している。月内で A社1,200円・B社1,500円を掛け持ちすると、全時間が片方の時給で計算される。**これは商用の給与計算としてバグ。**
3. **ルールが会社単位のみ**: `company_payroll_settings` は `company_id` が PK。派遣先ごとの所定労働時間・休憩・丸め・割増を持てない。
4. **GPS が検証されていない**: `/api/me/gps` は申告値をそのまま保存。打刻とは別リクエストなので、**呼ばなければ位置情報なしで打刻が成立する**。ジオフェンスも偽装検知も無い。

### 3-2. 提案するテーブル構成

```
companies
   │
   ├── clients（派遣先企業）
   │      └── client_sites（就業場所：1社に複数現場）★新規
   │             id, company_id, client_id, name, address,
   │             lat, lng, geofence_radius_m (default 300), timezone
   │
   ├── user_profiles（スタッフ）
   │
   ├── assignments（契約：スタッフ×派遣先×期間）
   │      └── shifts（日別シフト）+ site_id ★追加
   │
   ├── pay_rules（賃率・計算ルールの版管理）★新規・設計の中核
   │      id, company_id,
   │      scope        'company' | 'client' | 'assignment',
   │      client_id, assignment_id,          -- scope に応じて使用
   │      effective_from date, effective_to date,   -- 時間軸で版管理
   │      base_hourly_rate int,
   │      overtime_rate, overtime60_rate, night_rate, holiday_rate numeric,
   │      round_unit_min, round_mode, round_scope,
   │      prescribed_daily_min int,          -- 所定労働時間（派遣先ごと）
   │      deemed_break_json jsonb,           -- みなし休憩
   │      unique (company_id, scope, client_id, assignment_id, effective_from)
   │
   └── attendance（打刻）+ 以下を追加 ★
          punch_id uuid unique,              -- 冪等キー（課題1と共通）
          assignment_id, shift_id, site_id,  -- 直行直帰でどこにいたか
          distance_m numeric,                -- 就業場所からの距離
          geo_status text,                   -- inside|outside|unknown|denied
          location_source text,              -- gps|network
          is_mocked boolean,                 -- 端末が申告した mock フラグ
          device_id text, ip inet, ip_country text,
          risk_score int,                    -- 偽装疑いスコア 0-100
          deleted_at timestamptz             -- 物理削除禁止

   attendance_corrections（打刻修正の追記ログ）★新規
          id, company_id, attendance_id, before_json, after_json,
          reason text, corrected_by, corrected_at
```

### 3-3. ルール解決ロジック（純粋関数化する）

```
resolvePayRule(work_date, assignment_id, client_id, company_id, rules[]) →
    1) scope='assignment' かつ assignment_id 一致 かつ effective_from <= work_date < effective_to
    2) 無ければ scope='client'
    3) 無ければ scope='company'
    （同一 scope に複数あれば effective_from が最も新しいもの）
```

- **なぜ版管理が必須か**: 最低賃金は毎年10月に改定され、派遣先の時給改定も期中に起きる。`assignments.hourly_rate` を上書きする現状の設計では、**改定した瞬間に過去の確定給与の再計算結果が変わってしまう**。
- **確定済みデータはスナップショットする**: `timesheet_entries` に `applied_hourly_rate` `applied_rule_id` を保存し、締め後は「その時どのルールで計算したか」が凍結されるようにする。監査・労基署対応で必ず要る。
- 既存の `company_payroll_settings` は `scope='company'` の1行として無変換で移行できる（後方互換）。

### 3-4. 打刻と勤務地の紐付け（直行直帰）

打刻時に「その日そのスタッフのシフト」を引いて確定する:

```
1) shifts を (company_id, user_id経由のassignment, work_date が当日±1日) で検索
2) 1件 → その shift_id / assignment_id / site_id を確定
3) 複数（1日に2現場の掛け持ち）→ 打刻位置に最も近い site を選ぶ。
   それでも決まらなければ LIFF 画面で本人に選ばせる（現場を出す UI）
4) 0件（シフト外の緊急稼働）→ NULL のまま記録し、管理画面で「要確認」
```

この解決も純粋関数（`src/lib/dispatch/resolve-shift.ts`）にして `scripts/resolve_shift_selftest.ts` を `npm test` に追加する。

### 3-5. GPS 偽装対策 ― 「防止」ではなく「証跡と検知」に倒す

**技術的な事実として先に共有すべきこと**: LIFF（LINE の WebView）内の JavaScript から、Android の「仮の現在地」アプリや root 化端末による位置偽装を**完全に検知することはできない**。「GPS偽装を防止します」と顧客に約束するのは実装上不可能な約束であり、契約リスクになる。現実解は次の5層:

| 層 | 内容 | 効果 |
|---|---|---|
| **① ジオフェンス判定** | `client_sites.lat/lng` と打刻位置の距離を haversine で計算。`distance_m - accuracy <= radius` なら `inside` | 誤打刻・別現場打刻の検出 |
| **② 打刻は必ず通す** | 位置が取れなくても・圏外でも打刻は成立させ、`geo_status` を記録するだけ。ブロックすると現場が回らない | 運用が壊れない |
| **③ 人間の承認フロー** | `outside` / `denied` / 高 `risk_score` を管理画面に「要確認」で集約。日次サマリを派遣会社に通知 | 実質的な抑止力 |
| **④ ヒューリスティック検知** | ・`accuracy` が不自然に固定（常に 1〜5m）<br>・連続する打刻の緯度経度が完全一致<br>・前回打刻地点からの移動速度が非現実的（>300km/h）<br>・同一 `device_id` から複数スタッフの打刻<br>を加点して `risk_score` 化 | 偽装が「発覚する」状態にする |
| **⑤ 高リスク顧客向けオプション** | 現場に貼る**時限QRコード**（60秒ごとに更新されるトークン）や NFC タグ。GPS より偽装コストが桁違いに高い | 厳格運用の顧客に販売できる |

営業資料に書ける表現は「**GPS偽装を防止**」ではなく「**打刻位置を就業場所と自動照合し、逸脱を管理者に通知。監査証跡として保全**」。`らくらく勤怠/sales/` の表現もこれに合わせて修正すること。

### 3-6. 移行手順（非破壊）
1. `add column`（すべて nullable）+ `client_sites` / `pay_rules` / `attendance_corrections` 新設
2. `pay_rules` に既存 `company_payroll_settings` と `assignments.hourly_rate` を `scope='company'` / `scope='assignment'` として投入（`effective_from` は各 `start_date`）
3. 既存の打刻に、当日のシフトから `assignment_id` / `site_id` をバックフィル
4. 給与計算を `resolvePayRule` 経由に切り替え、`timesheet_entries.applied_hourly_rate` を保存
5. **確定済み（`status='confirmed'`）の `timesheets` は再計算しない**。過去の給与額は変えない
6. 新規打刻で `site_id` が埋まることを確認してから NOT NULL 化を検討

---

## 4. インフラ維持費の試算

### 4-1. 初期段階（10社 / スタッフ 500〜1,000人）

| サービス | プラン | 月額 (USD) | 円 (@155) | 備考 |
|---|---|---:|---:|---|
| Vercel | Pro（1シート） | $20 | 3,100 | Fluid Compute の従量は打刻が軽量なため初期は含み。超過 +$0〜10 |
| Supabase | Pro | $25 | 3,875 | $10 の compute クレジット込み |
| Supabase | Compute Small | $5 | 775 | $15 − クレジット$10 |
| Supabase | PITR 7日 | $100 | 15,500 | **商用要件の主コスト** |
| Supabase | IPv4 アドオン | $4 | 620 | GH Actions からの `pg_dump` 用 |
| Upstash | Redis 従量 | $1〜10 | 155〜1,550 | 3,000人×5コマンド×22日 ≒ 33万コマンド/月 |
| Upstash | QStash | $0〜10 | 0〜1,550 | 無料枠 500msg/日。ピーク帯 10秒間隔なら有償 |
| Sentry | Team | $26 | 4,030 | 導入済み |
| ログ基盤 | Better Stack / Axiom | $0〜25 | 0〜3,875 | Vercel Log Drain 先。初期は無料枠で足りる |
| 外形監視 | UptimeRobot | $0〜7 | 0〜1,085 | `/api/health` を1分間隔 |
| Cloudflare R2 | 従量 | $1 | 155 | バックアップ保管（〜50GB） |
| ドメイン | — | $1 | 155 | 年額を按分 |
| **合計（商用推奨構成）** | | **$208〜234** | **約3.2万〜3.6万円** | |

### 4-2. 構成別の比較

| 構成 | 月額 | 内容 | 妥当な場面 |
|---|---:|---|---|
| **A. 最小** | 約 $75（1.2万円） | Vercel Pro + Supabase Pro + Sentry。PITR/キュー無し | 無償トライアル・PoC のみ。有償販売には不可 |
| **B. 商用推奨** | 約 $210〜235（3.3万円） | 上表の全部。PITR + 論理バックアップ + キュー + 監視 | **販売開始時はここ** |
| **C. PITR 見送り** | 約 $110（1.7万円） | B から PITR を外し `pg_dump` を6時間ごとに | 価格を抑えたい初期。RPO 6時間を顧客に明示する条件付き |
| **D. 3,000人規模** | 約 $290（4.5万円） | B + Compute Medium（+$50）+ ログ従量増 | スタッフ3,000人／10〜30社 |

### 4-3. 事業性の目安
- 1社あたり月額 3万円で販売する場合、**顧客1社でインフラ原価を賄える**。
- 10社（月商30万円）でインフラ原価率は約 11%、SaaS としては健全な水準。
- 真の高可用性（マルチAZ・自動フェイルオーバー）は Supabase の Team/Enterprise 相当が必要で桁が変わる（$599/月〜）。初期に手を出す領域ではない。**リードレプリカ（+$15〜/月）による読み取り分散**の方が費用対効果が高く、必要になってからで間に合う。

---

## 5. 実行順序（優先度つき）

### P0 — 販売開始までに必須（見積 3〜4日）
1. `pg_dump` 日次バックアップ（GitHub Actions → R2、暗号化・世代管理）
2. Supabase を Pro に上げ、**PITR を有効化**
3. `attendance.punch_id`（冪等キー）+ UNIQUE 制約、`/api/me/clock` にレートリミット
4. GPS を打刻リクエストに同梱（往復 5 → 3）、`logAudit` を非同期化
5. `RUNBOOK.md` に PITR 復元手順・dump リストア手順を追記

### P1 — 初回顧客の運用中に（見積 1〜2週）
6. **`pay_rules` 導入と派遣先ごとの時給解決**（現在の給与計算バグの修正。最優先の実装課題）
7. `client_sites` + 打刻の `site_id` / `shift_id` 紐付け（直行直帰対応）
8. ジオフェンス判定と「要確認」フラグ・管理画面への集約
9. `attendance_corrections`（打刻修正の追記ログ）と論理削除
10. `me_session` への `company_id` 埋め込み + Redis によるセッション状態キャッシュ（往復 3 → 1）
11. リストア演習の月次定例化

### P2 — 規模が実際に増えてから
12. Upstash Streams + QStash によるフルキュー化、DLQ、締め前ゲート
13. ログ基盤（Log Drain → Better Stack / Axiom）と SLO ダッシュボード
14. 時限QRコード打刻（厳格運用オプションとして商品化）
15. リードレプリカによる管理画面の読み取り分散

---

## 6. 判断が必要な論点（要相談）

1. **PITR の $100/月を初期から払うか**（構成B）、**RPO 6時間で開始するか**（構成C）。有償サービスとしては B を推奨。
2. **キュー化（P2）をいつやるか**。数千人なら P0+P1 で足りる見込み。実測（Vercel の p95 レイテンシと Supabase の CPU）を見てから判断すべきで、先回りして入れると締め処理の整合リスクだけが増える。
3. **GPS 偽装対策の対外表現**。「防止」と書いている営業資料があれば「照合・検知・証跡」に修正が必要。
4. **確定済み給与の扱い**。`pay_rules` 移行時に過去分を再計算しない方針でよいか（推奨: 再計算しない）。
