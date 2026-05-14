-- ============================================================
-- 重複アカウント統合スクリプト
-- ============================================================
-- 同じ電話番号で複数アカウントが存在する場合に、
-- 古いアカウントのデータ（打刻・コンディション報告）を
-- 新しいアカウントに引き継ぎ、古い方を削除します。
-- ============================================================


-- ---------- STEP A：状況確認 ----------
-- どの電話番号が重複しているか確認
select
  phone,
  count(*) as duplicate_count,
  array_agg(user_id order by created_at) as user_ids_old_to_new,
  array_agg(display_name order by created_at) as names_old_to_new
from user_profiles
where phone is not null
group by phone
having count(*) > 1;


-- ---------- STEP B：自動統合（新しい方に統合・古い方を削除） ----------
-- target_phone を書き換えて実行してください
-- 同じ電話番号の中で、created_at が一番古いものを「古いアカウント」、
-- 一番新しいものを「新しいアカウント」として処理します。

do $$
declare
    target_phone text := '08098957770';  -- ← 統合したい電話番号に書き換え
    old_uid text;
    new_uid text;
    attendance_count int;
    condition_count int;
begin
    -- 最も古いアカウント（移行元）
    select user_id into old_uid
    from user_profiles
    where phone = target_phone
    order by created_at asc nulls last
    limit 1;

    -- 最も新しいアカウント（移行先）
    select user_id into new_uid
    from user_profiles
    where phone = target_phone
    order by created_at desc nulls last
    limit 1;

    if old_uid is null or new_uid is null then
        raise notice '電話番号 % のアカウントが見つかりません', target_phone;
        return;
    end if;

    if old_uid = new_uid then
        raise notice '重複なし（1アカウントのみ）：%', target_phone;
        return;
    end if;

    raise notice '======================================';
    raise notice '統合処理開始';
    raise notice '  電話番号: %', target_phone;
    raise notice '  古いUID（削除）: %', old_uid;
    raise notice '  新しいUID（残す）: %', new_uid;
    raise notice '======================================';

    -- 打刻データを移行
    update attendance
    set user_id = new_uid
    where user_id = old_uid;
    get diagnostics attendance_count = row_count;
    raise notice '✓ 打刻データ % 件を移行', attendance_count;

    -- コンディション報告を移行
    update condition_reports
    set user_id = new_uid
    where user_id = old_uid;
    get diagnostics condition_count = row_count;
    raise notice '✓ コンディション報告 % 件を移行', condition_count;

    -- 古いプロフィールを削除
    delete from user_profiles where user_id = old_uid;
    raise notice '✓ 古いアカウント削除完了';

    raise notice '======================================';
    raise notice '統合処理 完了';
    raise notice '======================================';
end $$;


-- ---------- STEP C：確認 ----------
-- 統合後、その電話番号のアカウントが1つだけになっていることを確認
select user_id, display_name, full_name, phone, role
from user_profiles
where phone = '08098957770';   -- ← STEP B と同じ電話番号

-- もう一度重複チェック
select
  phone,
  count(*) as duplicate_count
from user_profiles
where phone is not null
group by phone
having count(*) > 1;
-- ↑ 結果が0行なら、すべての重複が解消されています


-- ============================================================
-- 重要：このスクリプト実行後の運用方針
-- ============================================================
-- ・電話番号のユニーク制約はDB側では設けません
-- ・代わりに登録API（/api/me/register）が以下のルールで動作します：
--   - 同じ電話番号を持つ既存アカウントが admin → 登録を許可
--     （オーナー様の複数アカウント利用を想定）
--   - 同じ電話番号を持つ既存アカウントが staff → 登録を拒否
-- ・オーナー様の2つ目以降のアカウントは、登録後に手動で admin に昇格してください：
--     update user_profiles set role = 'admin' where user_id = 'U...';
-- ============================================================
