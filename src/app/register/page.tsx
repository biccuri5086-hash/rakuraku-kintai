"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiff } from "@/components/LiffProvider";
import { Phone, CheckCircle, AlertCircle, AlertTriangle, MapPin } from "lucide-react";
import { Footer } from "@/components/Footer";

export default function RegisterPage() {
  const { profile, authedFetch, isDemoMode, initError, isInClient } = useLiff();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{ phone: string; uid: string } | null>(null);
  const [diagResult, setDiagResult] = useState<string | null>(null);

  const handleDiag = async () => {
    setDiagResult("テスト中...");
    try {
      const res = await authedFetch("/api/me/profile", { cache: "no-store" });
      const data = await res.json();
      setDiagResult(`HTTP ${res.status}\n${JSON.stringify(data, null, 2)}`);
    } catch (e) {
      setDiagResult("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSubmit = async () => {
    if (!profile || loading) return;
    setError("");
    setLoading(true);

    const res = await authedFetch("/api/me/register", {
      method: "POST",
      body: JSON.stringify({ phone: input }),
    });
    const data = await res.json();

    if (!data.ok) {
      setError(data.message ?? "登録に失敗しました");
      setLoading(false);
      return;
    }

    setDebugInfo({ phone: data.phone, uid: profile.userId });
    setDone(true);
    setTimeout(() => router.push("/"), 1000);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 relative">
        <CheckCircle size={56} className="text-[#06C755]" />
        <h2 className="text-xl font-bold text-gray-800">登録完了！</h2>
        <p className="text-gray-400 text-sm">ホーム画面に移動します...</p>
        {process.env.NEXT_PUBLIC_DEBUG === "true" && debugInfo && (
          <div className="absolute bottom-4 left-4 right-4 bg-black/70 text-white text-xs rounded-lg p-3 font-mono">
            <p className="text-yellow-300 font-bold mb-1">[DEBUG] 登録確認</p>
            <p>📱 正規化済み電話番号: {debugInfo.phone}</p>
            <p>🔑 LINE UID: {debugInfo.uid}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <header className="bg-[#06C755] text-white px-4 py-3 shadow-md">
        <h1 className="text-lg font-bold">ラクラク勤怠</h1>
        <p className="text-xs text-green-100">初期設定</p>
      </header>

      <main className="flex flex-col flex-1 px-6 py-8 gap-6">
        {/* 診断パネル */}
        <div className={`rounded-2xl border p-4 ${isDemoMode ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
          <div className="flex items-center gap-2 mb-2">
            {isDemoMode ? (
              <AlertTriangle size={16} className="text-red-500" />
            ) : (
              <CheckCircle size={16} className="text-[#06C755]" />
            )}
            <p className={`text-xs font-bold ${isDemoMode ? "text-red-700" : "text-green-700"}`}>
              {isDemoMode ? "⚠ LIFF認証が動いていません（デモモード）" : "LIFF認証 OK"}
            </p>
          </div>
          <div className="text-[10px] font-mono text-gray-600 space-y-0.5">
            <p>isInClient: {String(isInClient)}</p>
            <p>isDemoMode: {String(isDemoMode)}</p>
            <p>userId: {profile?.userId ?? "(なし)"}</p>
            <p className="break-all">LIFF_ID env: [{process.env.NEXT_PUBLIC_LIFF_ID ?? "(未設定)"}]</p>
            <p>LIFF_ID 文字数: {(process.env.NEXT_PUBLIC_LIFF_ID ?? "").length}</p>
            {initError && <p className="text-red-600 break-all">initError: {initError}</p>}
          </div>
          <button
            type="button"
            onClick={handleDiag}
            className="mt-2 text-[11px] bg-blue-100 text-blue-700 px-2 py-1 rounded font-semibold"
          >
            認証テスト実行
          </button>
          {diagResult && (
            <pre className="mt-2 text-[10px] font-mono bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {diagResult}
            </pre>
          )}
        </div>

        <div className="text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Phone size={28} className="text-[#06C755]" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">電話番号を登録してください</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            本人確認のため、携帯電話番号を入力してください。
            <br />入力は1回のみです。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-600">
            携帯電話番号
          </label>
          <input
            type="tel"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="例：090-1234-5678"
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-[#06C755] text-gray-800 placeholder-gray-300"
            autoFocus
          />
          {error && (
            <div className="flex items-center gap-1.5 text-red-500 text-sm">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <p className="text-xs text-gray-400">
            ハイフンあり・なし、どちらでも入力できます
          </p>
        </div>

        <div className="bg-blue-50 rounded-xl p-3 flex gap-2 items-start border border-blue-100">
          <MapPin size={16} className="text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-600 leading-relaxed">
            打刻時に位置情報（GPS）を取得する場合があります。これは勤怠確認のためのみ使用され、
            ブラウザの許可設定でいつでも無効にできます。
            詳しくは<a href="/privacy" className="underline">プライバシーポリシー</a>をご確認ください。
          </p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!input || loading}
          className="bg-[#06C755] disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-2xl py-5 text-lg font-bold shadow-lg transition-all active:scale-95 mt-auto"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-4 border-white border-t-transparent rounded-full animate-spin" />
              登録中...
            </div>
          ) : (
            "同意して登録する"
          )}
        </button>
      </main>
      <Footer />
    </div>
  );
}
