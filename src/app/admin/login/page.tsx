"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, AlertCircle, KeyRound, Mail } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password || loading) return;
    if (showTotp && totp.length !== 6) {
      setError("6桁の認証コードを入力してください");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, totp: showTotp ? totp : undefined }),
    });

    const data = await res.json();

    if (data.ok) {
      router.replace("/admin");
      return;
    }

    if (data.code === "TOTP_REQUIRED") {
      setShowTotp(true);
      setError("認証コード（6桁）を入力してください");
      setLoading(false);
      return;
    }

    setError(data.message ?? "ログインに失敗しました");
    if (data.code !== "TOTP_INVALID") {
      setPassword("");
    }
    setTotp("");
    setLoading(false);
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
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="メールアドレス"
              autoComplete="username"
              autoFocus
              disabled={showTotp}
              className="w-full border-2 border-gray-200 rounded-xl pl-9 pr-4 py-3 text-base focus:outline-none focus:border-[#06C755] text-gray-800 disabled:bg-gray-50"
            />
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="パスワード"
            autoComplete="current-password"
            disabled={showTotp}
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#06C755] text-gray-800 disabled:bg-gray-50"
          />

          {showTotp && (
            <div className="flex flex-col gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
              <label className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                <KeyRound size={14} /> 認証アプリの6桁コード
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => { setTotp(e.target.value.replace(/\D/g, "")); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="123456"
                autoFocus
                className="border-2 border-blue-300 rounded-lg px-4 py-3 text-2xl font-mono text-center tracking-widest focus:outline-none focus:border-blue-500 text-gray-800"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 text-red-500 text-sm">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={handleLogin}
            disabled={!email || !password || loading || (showTotp && totp.length !== 6)}
            className="bg-[#06C755] disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-xl py-3 font-bold transition-all active:scale-95"
          >
            {loading ? "確認中..." : "ログイン"}
          </button>

          <p className="text-[10px] text-gray-400 text-center mt-2">
            アカウントをお持ちでない場合はサービス提供元にお問い合わせください
          </p>
        </div>
      </div>
    </div>
  );
}
