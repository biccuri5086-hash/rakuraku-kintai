"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ログインしたままにしている場合、この画面を開いたらそのまま運営画面へ進む
  useEffect(() => {
    let cancelled = false;
    fetch("/api/superadmin/me", { cache: "no-store" })
      .then((res) => { if (!cancelled && res.ok) router.replace("/superadmin"); })
      .catch(() => { /* 未ログインならこの画面のまま */ });
    return () => { cancelled = true; };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, totp: totp || undefined, remember }),
      });
      const data = await res.json();
      if (data.ok) {
        // 今のパスワードが条件を満たしていない場合は、まず変更画面へ案内する
        router.replace(data.passwordNeedsUpdate ? "/superadmin/password?weak=1" : "/superadmin");
      } else if (data.code === "TOTP_REQUIRED") {
        setNeedTotp(true);
        setError("認証アプリの6桁コードを入力してください");
      } else {
        if (data.code === "TOTP_INVALID") setNeedTotp(true);
        setError(data.message ?? "ログインに失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mb-3">
            <Shield className="text-white" size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">ラクラク勤怠</h1>
          <p className="text-xs text-amber-600 font-bold mt-1">プラットフォーム管理画面</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">パスワード</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 accent-amber-500"
            />
            <span>
              このブラウザで7日間ログインしたままにする
              <span className="block text-slate-400">
                次回から入力なしで開けます。共用のパソコンでは外してください。
              </span>
            </span>
          </label>

          {needTotp && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">認証コード（6桁）</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-lg font-mono text-center tracking-widest focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold py-2.5 rounded-lg disabled:opacity-50"
          >
            {loading ? "認証中..." : "ログイン"}
          </button>
        </form>

        <p className="text-[10px] text-slate-400 text-center mt-6">
          この画面はサービス運営者（小原健太）専用です。<br />
          派遣会社の管理者の方は /admin からログインしてください。
        </p>
      </div>
    </div>
  );
}
