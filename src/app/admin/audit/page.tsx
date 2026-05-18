"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Shield } from "lucide-react";

type AuditLog = {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  ip_address: string;
  user_agent: string;
  created_at: string;
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  admin_login_success: { label: "✅ ログイン成功", color: "text-green-700 bg-green-50" },
  admin_login_failure: { label: "❌ ログイン失敗", color: "text-red-700 bg-red-50" },
  admin_login_2fa_failure: { label: "❌ 2FAコード失敗", color: "text-red-700 bg-red-50" },
  admin_login_rate_limited: { label: "🚫 試行回数上限", color: "text-orange-700 bg-orange-50" },
  admin_logout: { label: "🚪 ログアウト", color: "text-gray-700 bg-gray-50" },
  admin_dashboard_view: { label: "👀 ダッシュボード閲覧", color: "text-blue-700 bg-blue-50" },
  admin_2fa_setup_view: { label: "🔐 2FA設定画面表示", color: "text-purple-700 bg-purple-50" },
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" }).then((res) => {
      if (res.ok) setAuthed(true);
      else router.replace("/admin/login");
    });
  }, [router]);

  const fetchLogs = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/audit?limit=200", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setLogs(data.ok ? data.logs : []);
    setLoading(false);
  };

  useEffect(() => {
    if (authed) fetchLogs();
  }, [authed]);

  if (!authed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/admin")} className="p-1">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-1.5">
              <Shield size={18} /> 監査ログ
            </h1>
            <p className="text-xs text-green-100">管理者の操作履歴</p>
          </div>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
        >
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-700">直近 {logs.length} 件</h2>
            <p className="text-xs text-gray-400">最大200件表示</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">ログがありません</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {logs.map((log) => {
                const label = ACTION_LABELS[log.action] ?? {
                  label: log.action,
                  color: "text-gray-700 bg-gray-50",
                };
                return (
                  <div key={log.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start gap-3 flex-wrap">
                      <span className={`inline-block text-xs font-bold px-2 py-1 rounded ${label.color}`}>
                        {label.label}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">
                        {formatDateTime(log.created_at)}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">
                        IP: {log.ip_address}
                      </span>
                    </div>
                    {log.details && Object.keys(log.details).length > 0 && (
                      <p className="text-xs text-gray-500 mt-1 font-mono break-all">
                        {JSON.stringify(log.details)}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-300 mt-1 truncate">
                      UA: {log.user_agent}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
