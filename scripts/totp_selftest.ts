// 2要素認証の自己テスト。
// verifyTOTP はログインの最後の砦なので、「正しいコードを通す」ことと
// 「それ以外を通さない」ことの両方を確かめる。
//
// 検証用のコードは、このファイル内で RFC 6238 に従って独立に生成している。
// アプリ側の実装を呼び出して作ったコードで検証しても、同じ間違いをしていれば
// 素通りしてしまうため。2つの実装が一致することをもって正しさの根拠とする。
import crypto from "node:crypto";
import { verifyTOTP, generateSecret, buildOtpAuthUrl } from "../src/lib/totp";

let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) { failed++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// base32 → バイト列（アプリ側とは独立に実装）
function decode(secret: string): Buffer {
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, "")) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("bad base32");
    bits += i.toString(2).padStart(5, "0");
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

// RFC 6238 / RFC 4226 の HOTP
function codeAt(secret: string, stepIndex: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(stepIndex));
  const h = crypto.createHmac("sha1", decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return (n % 1000000).toString().padStart(6, "0");
}

const step = () => Math.floor(Date.now() / 1000 / 30);
const secret = generateSecret();

// --- 正しいコードは通る ---
{
  ok("いまのコードは通る", verifyTOTP(secret, codeAt(secret, step())));
  ok("1つ前のコードも通る（時計のずれ許容）", verifyTOTP(secret, codeAt(secret, step() - 1)));
  ok("1つ後のコードも通る（時計のずれ許容）", verifyTOTP(secret, codeAt(secret, step() + 1)));
}

// --- 古すぎる／先すぎるコードは通らない ---
{
  ok("2つ前のコードは拒否", !verifyTOTP(secret, codeAt(secret, step() - 2)));
  ok("2つ後のコードは拒否", !verifyTOTP(secret, codeAt(secret, step() + 2)));
  ok("10分前のコードは拒否", !verifyTOTP(secret, codeAt(secret, step() - 20)));
}

// --- 別のシークレットのコードは通らない ---
{
  const other = generateSecret();
  ok("他人のコードは拒否", !verifyTOTP(secret, codeAt(other, step())));
}

// --- 形式が不正なものは通らない ---
{
  ok("空文字は拒否", !verifyTOTP(secret, ""));
  ok("5桁は拒否", !verifyTOTP(secret, "12345"));
  ok("7桁は拒否", !verifyTOTP(secret, "1234567"));
  ok("英字混じりは拒否", !verifyTOTP(secret, "12a456"));
  ok("空白入りは拒否", !verifyTOTP(secret, "123 56"));
}

// --- 総当たりされにくいこと（全コードが通ってしまわない） ---
{
  const valid = codeAt(secret, step());
  let accepted = 0;
  for (let i = 0; i < 300; i++) {
    const guess = i.toString().padStart(6, "0");
    if (guess !== valid && verifyTOTP(secret, guess)) accepted++;
  }
  ok("無関係な300通りは全て拒否", accepted === 0, `accepted=${accepted}`);
}

// --- シークレット生成 ---
{
  const list = Array.from({ length: 200 }, () => generateSecret());
  ok("base32の32文字（160bit）", list.every((s) => /^[A-Z2-7]{32}$/.test(s)));
  ok("200件すべて異なる", new Set(list).size === 200);
}

// --- 認証アプリに渡すURL ---
{
  const url = buildOtpAuthUrl("JBSWY3DPEHPK3PXP", "tanaka@example.com（アルファ人材株式会社）", "RakurakuKintai");
  ok("otpauth形式", url.startsWith("otpauth://totp/"));
  ok("シークレットを含む", url.includes("secret=JBSWY3DPEHPK3PXP"));
  ok("発行者を含む", url.includes("issuer=RakurakuKintai"));
  ok("6桁30秒", url.includes("digits=6") && url.includes("period=30"));
  ok("会社名や記号がURLエンコードされている", !/[ （）@]/.test(url.split("?")[0].split("/").pop() ?? ""));
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
