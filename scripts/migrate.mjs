// 追跡型マイグレーション・ランナー。
// db/migrations/*.sql を「ファイル名順」に適用し、schema_migrations テーブルに適用済みを記録する。
// 適用済みのファイルはスキップするので、ローカルでもCIでも何度実行しても安全（冪等）。
//
// 使い方:
//   DATABASE_URL="postgresql://..." npm run migrate            # 未適用を全部適用
//   DATABASE_URL="postgresql://..." npm run migrate -- --dry   # 何が適用されるか表示のみ
//   PG_SCHEMA="staging" DATABASE_URL="..." npm run migrate     # public以外のスキーマに適用（検証環境用）
//
// 接続文字列は環境変数 DATABASE_URL からのみ読む（ファイルには絶対に保存しない）。
// PG_SCHEMA を指定すると、そのスキーマを作成した上で search_path を切り替えて適用する。
// schema_migrations の適用済み管理もスキーマごとに独立する（publicとstagingで別々に追跡される）。
// 【本番では PG_SCHEMA を絶対に設定しないこと】（既定は public＝従来どおり）
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");
const dryRun = process.argv.includes("--dry");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL が未設定です。接続文字列を環境変数で渡してください。");
  process.exit(1);
}

const schema = (process.env.PG_SCHEMA ?? "public").trim() || "public";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error(`✗ PG_SCHEMA の形式が不正です: "${schema}"`);
  process.exit(1);
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0001_, 0002_ ... のゼロ埋め番号で辞書順＝適用順
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false }, // Supabase pooler は TLS 必須
});

try {
  await client.connect();
  console.log("接続OK");

  if (schema !== "public") {
    await client.query(`create schema if not exists "${schema}"`);
    console.log(`スキーマ "${schema}" に適用します（public とは独立）`);
  }
  // search_path の先頭を対象スキーマにする。pgcrypto 等の拡張関数は通常 extensions
  // スキーマにあり、デフォルトの search_path に含まれているため public を残しておいても問題ない。
  await client.query(`set search_path to "${schema}", public`);

  await client.query(`
    create table if not exists schema_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await client.query("select name from schema_migrations")).rows.map((r) => r.name)
  );
  const all = listMigrations();
  const pending = all.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("適用すべきマイグレーションはありません（全て適用済み）。");
    process.exit(0);
  }

  console.log(`未適用: ${pending.length}件 → ${pending.join(", ")}`);
  if (dryRun) {
    console.log("--dry のため実行しません。");
    process.exit(0);
  }

  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    console.log(`\n=== 適用: ${name} ===`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(name) values ($1)", [name]);
      await client.query("commit");
      console.log("→ 成功");
    } catch (e) {
      await client.query("rollback");
      console.error(`✗ 失敗: ${name} — ${e.message}`);
      console.error("（このマイグレーションはロールバックされました。以降は実行していません）");
      process.exitCode = 1;
      break;
    }
  }

  if (!process.exitCode) console.log("\n全マイグレーション完了");
} catch (e) {
  // 接続タイムアウト等は e.message が空になることがある(AggregateError等)。
  // code・原因の一覧も出して切り分けやすくする。
  const detail = e?.message || e?.code || String(e);
  console.error("✗ エラー:", detail);
  if (e?.code) console.error(`  (code: ${e.code})`);
  if (Array.isArray(e?.errors) && e.errors.length) {
    console.error("  内訳:");
    for (const inner of e.errors) console.error(`    - ${inner?.message || inner?.code || inner}`);
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
