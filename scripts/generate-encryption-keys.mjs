// 使い方:
//   node scripts/generate-encryption-keys.mjs
//
// 出力された2行を .env.local の末尾に追記してください。
// 同じ値を Vercel の環境変数にも登録してください。
//
// ⚠️ このキーは一度発行したら変更しないこと。
//    変更すると既存の暗号化データが復号できなくなる。
//
import crypto from "node:crypto";

const encKey = crypto.randomBytes(32).toString("base64");
const hashKey = crypto.randomBytes(32).toString("base64");

console.log("");
console.log("════════════════════════════════════════════════════════════");
console.log(" 📋 以下の2行を .env.local の末尾に追記してください");
console.log("════════════════════════════════════════════════════════════");
console.log("");
console.log(`PHONE_ENCRYPTION_KEY=${encKey}`);
console.log(`PHONE_HASH_KEY=${hashKey}`);
console.log("");
console.log("════════════════════════════════════════════════════════════");
console.log(" 📋 同じ値を Vercel の Environment Variables にも登録");
console.log("    (Production / Preview / Development 全部にチェック)");
console.log("════════════════════════════════════════════════════════════");
console.log("");
console.log("⚠️  このキーは絶対に紛失しないこと（紛失=全電話番号が復号不可）");
console.log("⚠️  認証情報.txt や Bitwarden にも保管してください");
console.log("");
