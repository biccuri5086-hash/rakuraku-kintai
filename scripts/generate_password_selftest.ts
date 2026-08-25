// 生成パスワードの自己テスト。運営が顧客に渡すものなので、弱いものが出ないことを担保する。
import { generatePassword, GENERATED_PASSWORD_LENGTH } from "../src/lib/generate-password";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const SAMPLES = 500;
const all = Array.from({ length: SAMPLES }, () => generatePassword());

ok("既定の長さは20文字", all.every((p) => p.length === 20));
ok("GENERATED_PASSWORD_LENGTH と一致", GENERATED_PASSWORD_LENGTH === 20);
ok("長さを指定できる", generatePassword(32).length === 32);

ok("必ず大文字を含む", all.every((p) => /[A-Z]/.test(p)));
ok("必ず小文字を含む", all.every((p) => /[a-z]/.test(p)));
ok("必ず数字を含む",   all.every((p) => /[0-9]/.test(p)));
ok("必ず記号を含む",   all.every((p) => /[!#%+=?@]/.test(p)));

// 読み違えやすい文字を除いてある（電話口で伝える場面を想定）
ok("紛らわしい文字(0 O o 1 l I)を含まない", all.every((p) => !/[0Oo1lI]/.test(p)));

// SQLやJSONに素で埋め込まれても壊れない文字だけを使う
ok("引用符・バックスラッシュを含まない", all.every((p) => !/['"`\\]/.test(p)));

// 生成の偏りを検出する。同じものが2回出たら乱数がおかしい。
ok(`${SAMPLES}件すべて異なる`, new Set(all).size === SAMPLES, `unique=${new Set(all).size}`);

// 先頭が常に大文字…のような固定パターンになっていないこと
const firstKinds = new Set(all.map((p) => (/[A-Z]/.test(p[0]) ? "U" : /[a-z]/.test(p[0]) ? "L" : /[0-9]/.test(p[0]) ? "D" : "S")));
ok("先頭の文字種が固定されていない", firstKinds.size >= 3, `kinds=${[...firstKinds].join(",")}`);

// 実際に使う場面：ログイン検証を通ること
import { hashPassword, verifyPassword } from "../src/lib/password";
const pw = generatePassword();
const h = hashPassword(pw);
ok("生成したパスワードでログイン検証が通る", verifyPassword(pw, h));
ok("別のパスワードでは通らない", !verifyPassword(generatePassword(), h));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
