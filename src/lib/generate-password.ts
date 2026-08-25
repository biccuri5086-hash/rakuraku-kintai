// 初期パスワード・再発行パスワードの生成。
//
// 人間が考えたパスワードはサービス名や年号を含みがちで推測されやすいため、
// 運営が手で決めるのではなく、ここで生成したものを渡す。
//
// 読み違えによる問い合わせを避けるため、紛らわしい文字は除いてある。
//   除外: 0 O o / 1 l I
import crypto from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!#%+=?@";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

export const GENERATED_PASSWORD_LENGTH = 20;

function pick(chars: string): string {
  return chars[crypto.randomInt(chars.length)];
}

export function generatePassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  // 4種すべてを最低1文字含める（種類が偏った文字列が出るのを防ぐ）
  const out = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (out.length < length) out.push(pick(ALL));

  // Fisher-Yates。先頭4文字が常に「大・小・数字・記号」の順になるのを崩す。
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}
