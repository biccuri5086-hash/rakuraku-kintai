// パスワード強度チェックの自己テスト。
// 画面とAPIが同じ関数を使うため、ここが壊れると弱いパスワードが本番に入る。
import { checkPassword, MIN_PASSWORD_LENGTH } from "../src/lib/password-policy";
import { generatePassword } from "../src/lib/generate-password";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}
const pass = (p: string, email?: string) => checkPassword(p, { email }).ok;

// --- 合格するもの ---
{
  ok("英字+数字+記号の12文字", pass("Kx7#mQz2vTrL"));
  ok("長めのフレーズ型", pass("umi-no-mieru-oka-2026!"));
  ok("記号が末尾でも可", pass("ShigotoBa2026!"));
  ok("生成したパスワードは必ず合格", Array.from({length:200}, () => generatePassword()).every((p) => pass(p)));
}

// --- 長さ ---
{
  ok("11文字は不合格", !pass("Kx7#mQz2vTr"));
  ok(`${MIN_PASSWORD_LENGTH}文字ちょうどは合格`, pass("Kx7#mQz2vTrL"));
  ok("129文字は不合格", !pass("A1!" + "a".repeat(126)));
  ok("空文字は不合格", !pass(""));
}

// --- 文字種 ---
{
  ok("英字だけは不合格", !pass("abcdefghijklmnop"));
  ok("数字だけは不合格", !pass("019283746501928374"));
  ok("記号だけは不合格", !pass("!#$%&@?+=!#$%&@?+="));
  ok("英字+数字（記号なし）は不合格", !pass("Kx7mQz2vTrLs"));
  ok("英字+記号（数字なし）は不合格", !pass("Kx#mQz$vTrLs"));
  ok("数字+記号（英字なし）は不合格", !pass("17#39$28?46!"));
}

// --- 全角・日本語 ---
{
  ok("日本語混じりは不合格", !pass("パスワード2026!abc"));
  ok("全角英数は不合格", !pass("Ｋｘ７＃ｍＱｚ２ｖＴｒ"));
}

// --- 推測されやすい語 ---
{
  ok("rakuraku を含むと不合格", !pass("Rakuraku2026!x"));
  ok("kintai を含むと不合格", !pass("Kintai-2026!ab"));
  ok("password を含むと不合格", !pass("MyPassword12!"));
  ok("admin を含むと不合格", !pass("Admin-2026!xyz"));
  ok("大文字小文字を変えても弾く", !pass("RaKuRaKu2026!x"));
}

// --- メールアドレスの流用 ---
{
  ok("ローカル部をそのまま含むと不合格", !pass("tanaka-2026!ab", "tanaka@example.com"));
  ok("無関係なら合格", pass("Kx7#mQz2vTrL", "tanaka@example.com"));
  ok("3文字以下のローカル部は判定しない", pass("abc#Kx7mQz2vTrL", "abc@example.com"));
}

// --- 単調な並び ---
{
  ok("同じ文字4連続は不合格", !pass("Kx#aaaa2vTrLm"));
  ok("3連続までは許容", pass("Kx#aaa2vTrLmn"));
  ok("12345 を含むと不合格", !pass("Kx#12345vTrLa"));
  ok("abcde を含むと不合格", !pass("Kx#abcde2TrLa"));
  ok("qwert を含むと不合格", !pass("Kx#qwert2TrLa"));
  ok("逆順の54321 も不合格", !pass("Kx#54321vTrLa"));
}

// --- 返り値の形 ---
{
  const r = checkPassword("abc");
  ok("不合格時は理由が返る", r.errors.length > 0);
  ok("条件ごとの充足が返る（長さ未達）", r.rules.length === false);
  ok("条件ごとの充足が返る（英字あり）", r.rules.letter === true);
  ok("条件ごとの充足が返る（数字なし）", r.rules.digit === false);
  const g = checkPassword("Kx7#mQz2vTrL");
  ok("合格時は理由が空", g.errors.length === 0 && g.ok);
  ok("合格時は全条件が true", Object.values(g.rules).every(Boolean));
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
