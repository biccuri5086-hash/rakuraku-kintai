"use client";

import { useEffect, useState } from "react";
import PasswordRules from "@/components/PasswordRules";
import { checkPassword } from "@/lib/password-policy";
import { useRouter } from "next/navigation";
import { LockKeyhole, ArrowLeft, CheckCircle } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // ログイン時に「今のパスワードが条件を満たしていない」と判定されて来た場合
  const [weak, setWeak] = useState(false);

  useEffect(() => {
    setWeak(new URLSearchParams(window.location.search).get("weak") === "1");
  }, []);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.ok) setAuthed(true);
        else router.replace("/admin/login");
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  const handleSave = async () => {
    setError(null);
    if (!current || !next) return setError("すべての項目を入力してください");
    const strength = checkPassword(next);
    if (!strength.ok) return setError(strength.errors[0]);
    if (next !== confirm) return setError("新しいパスワード（確認）が一致しません");
    setSaving(true);
    const res = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!data.ok) return setError(data.message ?? "変更に失敗しました");
    setDone(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  if (!authed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">権限確認中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button onClick={() => router.push("/admin")} className="p-1 rounded-full hover:bg-white/20 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <LockKeyhole size={18} /> パスワード変更
          </h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8">
        {weak && !done && (
          <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm font-bold text-orange-800 mb-1">パスワードの変更をお願いします</p>
            <p className="text-xs text-orange-700 leading-relaxed">
              今お使いのパスワードが、現在の条件（12文字以上・英字・数字・記号）を満たしていません。
              管理画面ではスタッフの給与額や連絡先を扱うため、この機会に変更してください。
            </p>
            <button
              onClick={() => router.replace("/admin")}
              className="mt-2.5 text-xs font-bold text-[#06C755] underline underline-offset-2"
            >
              あとで変更する
            </button>
          </div>
        )}
        {done ? (
          <div className="bg-white rounded-2xl shadow p-6 text-center">
            <CheckCircle size={40} className="text-[#06C755] mx-auto mb-3" />
            <p className="font-bold text-gray-800">パスワードを変更しました</p>
            <p className="text-sm text-gray-500 mt-1">次回から新しいパスワードでログインしてください。</p>
            <button
              onClick={() => router.push("/admin")}
              className="mt-5 bg-[#06C755] text-white font-bold px-5 py-2.5 rounded-lg hover:bg-[#05b34c] transition-colors"
            >
              ダッシュボードへ戻る
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow p-6 space-y-4">
            <p className="text-xs text-gray-500 leading-relaxed">
              本人確認のため、現在のパスワードが必要です。新しいパスワードは<span className="font-semibold">あなただけ</span>が管理します。
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <PwField label="現在のパスワード" value={current} onChange={setCurrent} />
            <PwField label="新しいパスワード" value={next} onChange={setNext} />
            <PasswordRules password={next} accent="green" />
            <PwField label="新しいパスワード（確認）" value={confirm} onChange={setConfirm} />
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-[#06C755] text-white font-bold py-3 rounded-lg hover:bg-[#05b34c] disabled:opacity-60 transition-colors"
            >
              {saving ? "変更中..." : "パスワードを変更する"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function PwField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <input
        type="password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#06C755]"
      />
    </label>
  );
}
