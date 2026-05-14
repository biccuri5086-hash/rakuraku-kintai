"use client";

import { useState } from "react";
import { useLiff } from "@/components/LiffProvider";
import { Copy, CheckCircle, AlertCircle, User } from "lucide-react";

export default function WhoamiPage() {
  const { isReady, profile } = useLiff();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック：選択するよう促す
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

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 px-6">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-gray-600 text-center">
          LINEから開いてください<br />
          <span className="text-xs text-gray-400">通常ブラウザでは表示できません</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <header className="bg-[#06C755] text-white px-4 py-3 shadow-md">
        <h1 className="text-lg font-bold">あなたのLINE情報</h1>
        <p className="text-xs text-green-100">管理者ロール設定用</p>
      </header>

      <main className="flex flex-col flex-1 px-6 py-8 gap-6">
        <div className="flex flex-col items-center gap-3 mt-4">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
            <User size={28} className="text-[#06C755]" />
          </div>
          <p className="text-lg font-bold text-gray-800">{profile.displayName}</p>
        </div>

        <div className="bg-white rounded-2xl shadow border border-gray-100 p-5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            LINE UID
          </label>
          <div className="mt-2 mb-3">
            <p className="font-mono text-sm text-gray-800 break-all bg-gray-50 rounded-lg p-3 select-all">
              {profile.userId}
            </p>
          </div>
          <button
            onClick={handleCopy}
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

        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <p className="text-xs text-blue-700 leading-relaxed font-semibold mb-2">
            管理者ロール設定SQL（Supabaseで実行）
          </p>
          <pre className="text-[10px] font-mono text-blue-800 bg-white rounded p-2 overflow-x-auto select-all whitespace-pre-wrap break-all">
{`update user_profiles
set role = 'admin'
where user_id = '${profile.userId}';`}
          </pre>
        </div>

        <p className="text-xs text-gray-400 text-center mt-auto">
          この画面は管理者設定後に削除されます
        </p>
      </main>
    </div>
  );
}
