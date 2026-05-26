// Supabase 全テーブルをJSONにダンプするバックアップスクリプト
// 使い方:
//   1. .env.local に SUPABASE_SERVICE_ROLE_KEY を一時的に追加
//   2. node --use-system-ca --env-file=.env.local scripts/backup-data.mjs
//      （Node 24+ on Windows では --use-system-ca が必須）
//   3. backup/ ディレクトリに <timestamp>_<table>.json が生成される
//
// マイグレーション失敗時の復元方法:
//   - Supabase SQL Editor で truncate table xxx;
//   - 同テーブルへ JSON を再import (Dashboard の Table Editor → Import data)

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が .env.local に設定されていません");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TABLES = ["user_profiles", "attendance", "condition_reports", "admin_audit_log"];

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = join(__dirname, "..", "backup", timestamp);
await mkdir(backupDir, { recursive: true });

console.log(`📦 バックアップ先: ${backupDir}\n`);

let totalRows = 0;
const summary = [];

for (const table of TABLES) {
  process.stdout.write(`  ${table.padEnd(20)} `);
  const { data, error, count } = await supabase
    .from(table)
    .select("*", { count: "exact" });

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      console.log(`⚠️  テーブルなし（スキップ）`);
      summary.push({ table, rows: 0, skipped: true });
      continue;
    }
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  const filePath = join(backupDir, `${table}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✅ ${count} 件`);
  totalRows += count ?? 0;
  summary.push({ table, rows: count ?? 0, file: filePath });
}

await writeFile(
  join(backupDir, "_summary.json"),
  JSON.stringify({ timestamp, totalRows, tables: summary }, null, 2),
  "utf-8"
);

console.log(`\n✨ 完了: 合計 ${totalRows} 行を ${backupDir} に保存しました`);
console.log(`\n復元したい場合は backup/<timestamp>/ のJSONを Supabase Table Editor からインポート可能です`);
