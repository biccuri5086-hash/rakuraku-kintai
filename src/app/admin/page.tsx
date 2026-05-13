"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Users, Clock, AlertCircle, LogOut } from "lucide-react";

type ConditionRow = {
  id: string;
  user_id: string;
  score: number;
  comment: string | null;
  reported_at: string;
};

type UserSummary = {
  user_id: string;
  user_name: string;
  clockIn: string | null;
  clockOut: string | null;
  condition: ConditionRow | null;
};

const CONDITION_LABELS: Record<number, { emoji: string; label: string; bg: string; text: string }> = {
  5: { emoji: "😄", label: "絶好調", bg: "bg-green-100", text: "text-green-700" },
  4: { emoji: "😊", label: "良い", bg: "bg-lime-100", text: "text-lime-700" },
  3: { emoji: "😐", label: "普通", bg: "bg-yellow-100", text: "text-yellow-700" },
  2: { emoji: "😔", label: "疲れ", bg: "bg-orange-100", text: "text-orange-700" },
  1: { emoji: "😢", label: "しんどい", bg: "bg-red-100", text: "text-red-700" },
};

function formatTime(iso: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function calcWorkHours(clockIn: string | null, clockOut: string | null): string {
  if (!clockIn || !clockOut) return "--";
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function AdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setAuthed(true);
        } else {
          router.replace("/admin/login");
        }
      })
      .catch(() => {
        if (!cancelled) router.replace("/admin/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/dashboard?date=${date}`, { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setUsers(data.ok ? data.users : []);
    setLastUpdated(new Date());
    setLoading(false);
  }, [date, router]);

  useEffect(() => {
    if (authed) fetchData();
  }, [authed, fetchData]);

  const presentCount = users.filter((u) => u.clockIn).length;
  const alertCount = users.filter((u) => u.condition && u.condition.score <= 2).length;

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
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">ラクラク勤怠</h1>
          <p className="text-xs text-green-100">管理者ダッシュボード</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="bg-white rounded-2xl shadow p-4 flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-500">表示日付</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#06C755]"
          />
          {lastUpdated && (
            <span className="text-xs text-gray-400 ml-auto">
              {lastUpdated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 更新
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl shadow p-4 text-center">
            <Users size={20} className="text-[#06C755] mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-800">{users.length}</p>
            <p className="text-xs text-gray-400">登録スタッフ</p>
          </div>
          <div className="bg-white rounded-2xl shadow p-4 text-center">
            <Clock size={20} className="text-blue-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-800">{presentCount}</p>
            <p className="text-xs text-gray-400">出勤済み</p>
          </div>
          <div className={`rounded-2xl shadow p-4 text-center ${alertCount > 0 ? "bg-red-50" : "bg-white"}`}>
            <AlertCircle size={20} className={`mx-auto mb-1 ${alertCount > 0 ? "text-red-500" : "text-gray-300"}`} />
            <p className={`text-2xl font-bold ${alertCount > 0 ? "text-red-600" : "text-gray-800"}`}>{alertCount}</p>
            <p className="text-xs text-gray-400">要フォロー</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-bold text-gray-700">スタッフ一覧</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">この日の打刻データはありません</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">名前</th>
                  <th className="text-center px-2 py-2">出勤</th>
                  <th className="text-center px-2 py-2">退勤</th>
                  <th className="text-center px-2 py-2">勤務時間</th>
                  <th className="text-center px-2 py-2">コンディション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => {
                  const cond = u.condition ? CONDITION_LABELS[u.condition.score] : null;
                  const isAlert = u.condition && u.condition.score <= 2;
                  return (
                    <tr key={u.user_id} className={isAlert ? "bg-red-50" : ""}>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {isAlert && <span className="text-red-500 mr-1">!</span>}
                        {u.user_name}
                        {u.condition?.comment && (
                          <p className="text-xs text-gray-400 font-normal mt-0.5 truncate max-w-[120px]">
                            {u.condition.comment}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3 text-center font-mono text-gray-700">
                        {formatTime(u.clockIn)}
                      </td>
                      <td className="px-2 py-3 text-center font-mono text-gray-700">
                        {formatTime(u.clockOut)}
                      </td>
                      <td className="px-2 py-3 text-center text-gray-600">
                        {calcWorkHours(u.clockIn, u.clockOut)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        {cond ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${cond.bg} ${cond.text}`}>
                            {cond.emoji} {cond.label}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">未報告</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
