// 使い方:
//   1. .env.local に PHONE_ENCRYPTION_KEY と PHONE_HASH_KEY を追記
//      （SUPABASE_SERVICE_ROLE_KEY と NEXT_PUBLIC_SUPABASE_URL は既存）
//   2. node --use-system-ca --env-file=.env.local scripts/migrate-phone-encryption.mjs
//
// 既存の user_profiles.phone（平文）を暗号化 + phone_hash 付与に変換する。
// 既に v1: で始まる行はスキップ（冪等）。
//
import crypto from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encKeyB64 = process.env.PHONE_ENCRYPTION_KEY;
const hashKeyB64 = process.env.PHONE_HASH_KEY;

if (!url || !serviceKey || !encKeyB64 || !hashKeyB64) {
  console.error("❌ .env.local に以下が揃っているか確認してください:");
  console.error("   - NEXT_PUBLIC_SUPABASE_URL");
  console.error("   - SUPABASE_SERVICE_ROLE_KEY");
  console.error("   - PHONE_ENCRYPTION_KEY");
  console.error("   - PHONE_HASH_KEY");
  process.exit(1);
}

const encKey = Buffer.from(encKeyB64, "base64");
const hashKey = Buffer.from(hashKeyB64, "base64");
if (encKey.length !== 32) throw new Error("PHONE_ENCRYPTION_KEY must be 32 bytes base64");
if (hashKey.length < 32) throw new Error("PHONE_HASH_KEY must be >= 32 bytes base64");

function encryptPhone(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), enc.toString("base64"), tag.toString("base64")].join(":");
}

function hashPhone(plaintext) {
  return crypto.createHmac("sha256", hashKey).update(plaintext).digest("base64url");
}

async function sb(path, init) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const rows = await sb(`/rest/v1/user_profiles?select=user_id,phone,phone_hash`, { method: "GET" });
console.log(`📊 対象行数: ${rows.length}`);

let migrated = 0, skipped = 0, empty = 0;
for (const row of rows) {
  if (!row.phone) { empty++; continue; }
  if (row.phone.startsWith("v1:")) { skipped++; continue; }

  const enc = encryptPhone(row.phone);
  const hash = hashPhone(row.phone);
  await sb(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    body: JSON.stringify({ phone: enc, phone_hash: hash }),
  });
  migrated++;
  process.stdout.write(`.`);
}

console.log(`\n✨ 完了: 暗号化=${migrated} / 既に暗号化済=${skipped} / 空欄=${empty}`);
