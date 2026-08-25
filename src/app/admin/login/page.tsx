"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, AlertCircle, KeyRound, Mail, Building2 } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [showTotp, setShowTotp] = useState(false);
  const [remember, setRemember] = useState(true);
  const [companies, setCompanies] = useState<{ id: string; name: string }[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ログインしたままにしている場合、この画面を開いたらそのまま管理画面へ進む
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => { if (!cancelled && res.ok) router.replace("/admin"); })
      .catch(() => { /* 未ログインならこの画面のまま */ });
    return () => { cancelled = true; };
  }, [router]);

  // selectedCompanyId は会社選択ボタンから直接渡す。setCompanyId の反映を待つと
  // 1回目の送信に間に合わないため。
  const handleLogin = async (selectedCompanyId?: string) => {
    if (!email || !password || loading) return;
    if (showTotp && totp.length !== 6) {
      setError("6桁の認証コードを入力してください");
      return;
    }
    const useCompanyId = selectedCompanyId ?? companyId;
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        companyId: useCompanyId || undefined,
        totp: showTotp ? totp : undefined,
        remember,
      }),
    });

    const data = await res.json();

    if (data.ok) {
      // 今のパスワードが条件を満たしていない人は、まず変更画面へ案内する
      router.replace(data.passwordNeedsUpdate ? "/admin/password?weak=1" : "/admin");
      return;
    }

    // 同じメールが複数の会社に登録されている場合。パスワードは照合済み。
    if (data.code === "COMPANY_SELECT") {
      setCompanies(data.companies ?? []);
      setError("ログインする会社を選択してください");
      setLoading(false);
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
      setCompanies(null);
      setCompanyId("");
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
              disabled={showTotp || !!companies}
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
            disabled={showTotp || !!companies}
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-[#06C755] text-gray-800 disabled:bg-gray-50"
          />

          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 accent-[#06C755]"
            />
            <span>
              このブラウザで7日間ログインしたままにする
              <span className="block text-gray-400">
                次回から入力なしで開けます。共用のパソコンでは外してください。
              </span>
            </span>
          </label>

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

          {companies && !showTotp && (
            <div className="flex flex-col gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <label className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                <Building2 size={14} /> ログインする会社を選択
              </label>
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setCompanyId(c.id); handleLogin(c.id); }}
                  disabled={loading}
                  className="text-left border-2 border-amber-300 bg-white rounded-lg px-4 py-2.5 text-sm font-medium text-gray-800 active:scale-95 transition-all disabled:opacity-50"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 text-red-500 text-sm">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          {!(companies && !showTotp) && (
            <button
              onClick={() => handleLogin()}
              disabled={!email || !password || loading || (showTotp && totp.length !== 6)}
              className="bg-[#06C755] disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-xl py-3 font-bold transition-all active:scale-95"
            >
              {loading ? "確認中..." : "ログイン"}
            </button>
          )}

          <p className="text-[10px] text-gray-400 text-center mt-2">
            アカウントをお持ちでない場合はサービス提供元にお問い合わせください
          </p>
        </div>
      </div>
    </div>
  );
}
