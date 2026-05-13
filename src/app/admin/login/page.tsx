"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, AlertCircle } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!password || loading) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (data.ok) {
      router.replace("/admin");
    } else {
      setError(data.message ?? "パスワードが違います");
      setPassword("");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center">
            <Lock size={26} className="text-[#06C755]" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">管理者ログイン</h1>
          <p className="text-sm text-gray-400 text-center">ラクラク勤怠 管理者ダッシュボード</p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="パスワードを入力"
            autoFocus
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#06C755] text-gray-800"
          />
          {error && (
            <div className="flex items-center gap-1.5 text-red-500 text-sm">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={handleLogin}
            disabled={!password || loading}
            className="bg-[#06C755] disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-xl py-3 font-bold transition-all active:scale-95"
          >
            {loading ? "確認中..." : "ログイン"}
          </button>
        </div>
      </div>
    </div>
  );
}
