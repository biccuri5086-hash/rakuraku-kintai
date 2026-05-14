"use client";

import { useState } from "react";
import { useLiff } from "@/components/LiffProvider";
import { Copy, CheckCircle, AlertTriangle, User } from "lucide-react";

export default function WhoamiPage() {
  const { isReady, profile, isDemoMode, isInClient, initError } = useLiff();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!isReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">LINE 認証中...</p>
      </div>
    );
  }

  const isDemo = isDemoMode || profile?.userId === "demo_user_001";

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <header className="bg-[#06C755] text-white px-4 py-3 shadow-md">
        <h1 className="text-lg font-bold">LINE接続診断</h1>
        <p className="text-xs text-green-100">管理者ロール設定用</p>
      </header>

      <main className="flex flex-col flex-1 px-6 py-6 gap-5">
        {isDemo ? (
          <div className="bg-red-50 rounded-2xl border border-red-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={22} className="text-red-500" />
              <p className="text-red-700 font-bold">デモモードです</p>
            </div>
            <p className="text-sm text-red-800 leading-relaxed mb-3">
              LINE LIFF の初期化に失敗しました。実際のあなたのLINE UIDは取得できていません。
            </p>
            {initError && (
              <div className="bg-white rounded-lg p-2 mb-3">
                <p className="text-[10px] text-gray-500 font-mono break-all">
                  原因: {initError}
                </p>
              </div>
            )}
            <p className="text-xs text-red-700 font-semibold mb-1">考えられる原因：</p>
            <ul className="text-xs text-red-700 leading-relaxed list-disc list-inside space-y-1">
              <li>通常ブラウザで開いている（LINEから開いてください）</li>
              <li>LIFF設定のEndpoint URLが本番URLと一致していない</li>
              <li>LINEログインチャネルが「非公開」になっている</li>
            </ul>
          </div>
        ) : (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-[#06C755]" />
              <p className="text-green-700 text-sm font-bold">LINE認証 OK</p>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
            <User size={28} className="text-[#06C755]" />
          </div>
          <p className="text-lg font-bold text-gray-800">{profile?.displayName}</p>
        </div>

        <div className="bg-white rounded-2xl shadow border border-gray-100 p-5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            LINE UID
          </label>
          <div className="mt-2 mb-3">
            <p className="font-mono text-sm text-gray-800 break-all bg-gray-50 rounded-lg p-3 select-all">
              {profile?.userId}
            </p>
          </div>
          <button
            onClick={handleCopy}
            disabled={!profile}
            className={`w-full rounded-xl py-3 font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
              copied ? "bg-green-100 text-green-700" : "bg-[#06C755] text-white"
            }`}
          >
            {copied ? (
              <>
                <CheckCircle size={18} /> コピーしました
              </>
            ) : (
              <>
                <Copy size={18} /> コピーする
              </>
            )}
          </button>
        </div>

        {!isDemo && (
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <p className="text-xs text-blue-700 leading-relaxed font-semibold mb-2">
              管理者ロール設定SQL（Supabase SQL Editor で実行）
            </p>
            <pre className="text-[10px] font-mono text-blue-800 bg-white rounded p-2 overflow-x-auto select-all whitespace-pre-wrap break-all">
{`update user_profiles
set role = 'admin'
where user_id = '${profile?.userId}';`}
            </pre>
          </div>
        )}

        <div className="bg-gray-50 rounded-xl p-3 text-[10px] text-gray-500 font-mono">
          <p>isInClient (LINEアプリ内): {String(isInClient)}</p>
          <p>isDemoMode: {String(isDemo)}</p>
        </div>
      </main>
    </div>
  );
}
