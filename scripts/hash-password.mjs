// 使い方:
//   node scripts/hash-password.mjs <パスワード>
// 例:
//   node scripts/hash-password.mjs "Rakurakukintai 2026@"
// 出力された scrypt$... 形式のハッシュをSupabaseのSQLで使う。
import crypto from "node:crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;
const SCRYPT_COST = 16384;

const plain = process.argv[2];
if (!plain) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const salt = crypto.randomBytes(SALT_LEN);
const derived = crypto.scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_COST });
const hash = `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
console.log(hash);
