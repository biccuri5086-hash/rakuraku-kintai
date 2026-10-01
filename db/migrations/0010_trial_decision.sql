-- トライアル終了前の「続ける／やめる」選択を保存する（additive・再実行安全）。
-- 'stop' を選んだ会社のみ、trial_ends_at を過ぎたらアプリ層で利用停止にする。
alter table companies add column if not exists trial_decision text
  check (trial_decision in ('continue','stop'));
alter table companies add column if not exists trial_decision_at timestamptz;
