"use client";

import { Check, X } from "lucide-react";
import { checkPassword, PASSWORD_RULE_LABELS } from "@/lib/password-policy";

// 入力中のパスワードが条件を満たしているかをその場で表示する。
// 判定は API と同じ checkPassword を呼ぶので、「画面では緑なのに保存できない」が起きない。
export default function PasswordRules({
  password,
  email,
  accent = "green",
}: {
  password: string;
  email?: string;
  /** 画面ごとのテーマ色。管理画面は緑、運営画面は琥珀色 */
  accent?: "green" | "amber";
}) {
  // 長さ・文字種はチェックリストで示し、それ以外の指摘は文章で下に出す
  const { rules, otherErrors } = checkPassword(password, { email });
  const okColor = accent === "amber" ? "text-amber-600" : "text-green-600";

  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {PASSWORD_RULE_LABELS.map(({ key, label }) => {
          const met = rules[key];
          return (
            <li
              key={key}
              className={`flex items-center gap-1 text-[11px] ${
                met ? okColor : password.length === 0 ? "text-gray-400" : "text-gray-500"
              }`}
            >
              {met ? <Check size={12} /> : <X size={12} className={password.length ? "text-red-400" : ""} />}
              {label}
            </li>
          );
        })}
      </ul>
      {password.length > 0 && otherErrors.length > 0 && (
        <ul className="space-y-0.5">
          {otherErrors.map((e) => (
            <li key={e} className="text-[11px] text-red-500 flex items-start gap-1">
              <X size={12} className="shrink-0 mt-0.5" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
