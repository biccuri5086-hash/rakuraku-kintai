// security-guard.ts の自己テスト。
// 弱いSESSION_SECRETの取りこぼしは全社データ削除に直結するため、ここが要。
import {
  checkSessionSecret,
  confirmationMatches,
  MIN_SECRET_LENGTH,
  RECOMMENDED_SECRET_LENGTH,
} from "../src/lib/security-guard";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const good = (s: string | undefined | null) => checkSessionSecret(s).ok;

// --- 弱い鍵は必ず拒否 ---
{
  ok("未設定は拒否", !good(undefined));
  ok("空文字は拒否", !good(""));
  ok("短すぎる鍵は拒否", !good("abc123"));
  ok("既定値 changeme を含む鍵は拒否", !good("prod-changeme-000000000000000000"));
  ok("dev-secret-changeme は拒否（今回の実証経路）", !good("dev-secret-changeme"));
  ok("password を含む鍵は拒否", !good("my-password-secret-key-abcdefgh12"));
  ok("your-secret を含む鍵は拒否", !good("your-secret-value-1234567890abcd"));
  ok("完全一致の弱語 secret は拒否", !good("secret"));
  ok("反復のみ(低エントロピー)は拒否", !good("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  ok("ababab...(低エントロピー)は拒否", !good("abababababababababab"));
}

// --- 強い鍵は許可 ---
{
  const strong = "Zx9Kq2Lp7Vt4Rw8Nb1Mc6Yf3Hg5Ds0Aj"; // 33 chars, 高エントロピー
  ok("強いランダム鍵は許可", good(strong));
  ok("強い鍵に警告なし", checkSessionSecret(strong).ok && !(checkSessionSecret(strong) as { warning?: string }).warning);
  const shortish = "Zx9Kq2Lp7Vt4Rw8Nb"; // 18 chars: 下限以上・推奨未満
  const v = checkSessionSecret(shortish);
  ok(`${MIN_SECRET_LENGTH}以上${RECOMMENDED_SECRET_LENGTH}未満は許可だが警告`, v.ok && !!(v as { warning?: string }).warning);
}

// --- 破壊操作の確認一致 ---
{
  ok("会社名が一致すれば true", confirmationMatches("アルファ人材", "アルファ人材"));
  ok("前後空白は許容して一致", confirmationMatches("アルファ人材", "  アルファ人材  "));
  ok("不一致は false", !confirmationMatches("アルファ人材", "ベータ"));
  ok("空の確認入力は false", !confirmationMatches("アルファ人材", ""));
  ok("expected が空なら常に false", !confirmationMatches("", "アルファ人材"));
  ok("非文字列は false", !confirmationMatches("アルファ人材", 123 as unknown));
  ok("null は false", !confirmationMatches("アルファ人材", null));
}

if (failed > 0) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nsecurity_guard_selftest: all passed");
