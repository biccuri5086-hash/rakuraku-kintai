// 追跡型マイグレーション・ランナー。
// db/migrations/*.sql を「ファイル名順」に適用し、schema_migrations テーブルに適用済みを記録する。
// 適用済みのファイルはスキップするので、ローカルでもCIでも何度実行しても安全（冪等）。
//
// 使い方:
//   DATABASE_URL="postgresql://..." npm run migrate            # 未適用を全部適用
//   DATABASE_URL="postgresql://..." npm run migrate -- --dry   # 何が適用されるか表示のみ
//
// 接続文字列は環境変数 DATABASE_URL からのみ読む（ファイルには絶対に保存しない）。
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
  console.error("✗ エラー:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
