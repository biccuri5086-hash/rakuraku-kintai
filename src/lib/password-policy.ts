// パスワードの強度チェック。管理者が自分で決めるパスワードに最低ラインを設ける。
//
// 管理画面はスタッフの給与額・住所・電話番号を扱うため、パスワードが破られると
// 個人情報がまとめて漏れる。一方で毎回入力するものなので、自動生成の長い文字列を
// 強制すると使ってもらえない（付箋に書かれる）。「自分で決められるが弱すぎるものは
// 弾く」の線を引くのがこのモジュールの役割。
//
// 判定は純粋関数。画面とAPIの両方から同じ関数を呼び、表示と実際の可否をずらさない。

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordCheck = {
  /** 満たしていない条件の一覧（ruleErrors と otherErrors を合わせたもの）。空なら合格 */
  errors: string[];
  /** 長さ・文字種の不足。画面ではチェックリストで表すので、文章としては出さない */
  ruleErrors: string[];
  /** 推測されやすい語や連番など、チェックリストで表せない指摘 */
  otherErrors: string[];
  /** 個別の条件の充足状況。画面のチェックリスト表示に使う */
  rules: {
    length: boolean;
    letter: boolean;
    digit: boolean;
    symbol: boolean;
  };
  ok: boolean;
};

// サービス名から推測されるパスワードは真っ先に試される
const BANNED_WORDS = ["rakuraku", "kintai", "らくらく", "勤怠", "password", "admin"];

// 使い回されがちな並び
const SEQUENCES = [
  "0123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

function hasSequence(lower: string, minRun = 5): boolean {
  for (const seq of SEQUENCES) {
    for (let i = 0; i + minRun <= seq.length; i++) {
      const run = seq.slice(i, i + minRun);
      if (lower.includes(run)) return true;
      const reversed = [...run].reverse().join("");
      if (lower.includes(reversed)) return true;
    }
  }
  return false;
}

export function checkPassword(plain: string, opts: { email?: string } = {}): PasswordCheck {
  const rules = {
    length: plain.length >= MIN_PASSWORD_LENGTH && plain.length <= MAX_PASSWORD_LENGTH,
    letter: /[A-Za-z]/.test(plain),
    digit: /[0-9]/.test(plain),
    // 英数字以外の印字可能なASCII文字を記号とみなす
    symbol: /[!-/:-@[-`{-~]/.test(plain),
  };

  // 長さと文字種の不足。画面ではチェックリストで示す
  const ruleErrors: string[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) {
    ruleErrors.push(`${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    ruleErrors.push(`${MAX_PASSWORD_LENGTH}文字以内にしてください`);
  }
  if (!rules.letter) ruleErrors.push("英字（a〜z / A〜Z）を1文字以上入れてください");
  if (!rules.digit) ruleErrors.push("数字（0〜9）を1文字以上入れてください");
  if (!rules.symbol) ruleErrors.push("記号（! # $ % & @ ? + = など）を1文字以上入れてください");

  // チェックリストでは表せない指摘
  const otherErrors: string[] = [];

  // ログイン時の打ち間違いを避けるため、日本語入力が要る文字は使わせない
  if (/[^\x20-\x7E]/.test(plain)) {
    otherErrors.push("半角の英数字と記号だけで入力してください（日本語や全角文字は使えません）");
  }

  const lower = plain.toLowerCase();

  for (const word of BANNED_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      otherErrors.push(`「${word}」のような推測されやすい語は使えません`);
      break;
    }
  }

  // メールアドレスの @ より前をそのまま使うのは、名前をパスワードにするのと同じ
  const local = (opts.email ?? "").split("@")[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) {
    otherErrors.push("メールアドレスの一部をそのまま含めることはできません");
  }

  if (/(.)\1{3,}/.test(plain)) {
    otherErrors.push("同じ文字を4回以上続けないでください");
  }

  if (hasSequence(lower)) {
    otherErrors.push("「12345」「abcde」「qwert」のような連続した並びは使えません");
  }

  const all = [...ruleErrors, ...otherErrors];
  return { errors: all, ruleErrors, otherErrors, rules, ok: all.length === 0 };
}

/** 画面に出す条件の説明文（APIの判定と同じ内容を人が読む形にしたもの） */
export const PASSWORD_RULE_LABELS: { key: keyof PasswordCheck["rules"]; label: string }[] = [
  { key: "length", label: `${MIN_PASSWORD_LENGTH}文字以上` },
  { key: "letter", label: "英字を1文字以上" },
  { key: "digit", label: "数字を1文字以上" },
  { key: "symbol", label: "記号を1文字以上" },
];
