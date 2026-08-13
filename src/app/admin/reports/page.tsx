"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, LogOut, Download, AlertTriangle } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Row = {
  user_id: string;
  staff_name: string;
  days: number;
  totalMinutes: number;
  totalHm: string;
  missingClockOut: number;
  hourlyRate: number | null;
  estimatedPay: number | null;
};

function thisMonth(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

export default function ReportsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.ok) {
          setAuthed(true);
          setCompanyName(data.company?.name ?? "ラクラク勤怠");
        } else {
          router.replace("/admin/login");
        }
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/reports/monthly?month=${month}`, { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setRows(data.ok ? data.rows : []);
    setLoading(false);
  }, [month, router]);

  useEffect(() => {
    if (authed) fetchReport();
  }, [authed, fetchReport]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  const downloadCsv = () => {
    window.location.href = `/api/admin/reports/monthly?month=${month}&format=csv`;
  };

  if (!authed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">権限確認中...</p>
      </div>
    );
  }

  const totalDays = rows.reduce((s, r) => s + r.days, 0);
  const totalMin = rows.reduce((s, r) => s + r.totalMinutes, 0);
  const totalMissing = rows.reduce((s, r) => s + r.missingClockOut, 0);
  const totalPay = rows.reduce((s, r) => s + (r.estimatedPay ?? 0), 0);
  const yen = (n: number) => `¥${n.toLocaleString()}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p className="text-xs text-green-100">月次レポート</p>
        </div>
        <button
          onClick={handleLogout}
          title="ログアウト"
          className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
        >
          <LogOut size={18} />
        </button>
      </header>

      <AdminNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-gray-700 flex items-center gap-2">
            <BarChart3 size={18} className="text-[#06C755]" /> 月次勤怠集計
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
            />
            <button
              onClick={downloadCsv}
              disabled={rows.length === 0}
              className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] disabled:opacity-50 transition-colors"
            >
              <Download size={16} /> CSV
            </button>
          </div>
        </div>

        {totalMissing > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" />
            退勤打刻もれが <span className="font-bold">{totalMissing}件</span> あります。実働時間に含まれていません。
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <BarChart3 size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">この月の勤怠記録がありません</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard label="対象スタッフ" value={`${rows.length}名`} />
              <SummaryCard label="延べ出勤日数" value={`${totalDays}日`} />
              <SummaryCard label="実働合計" value={`${Math.floor(totalMin / 60)}時間`} />
              <SummaryCard label="概算支給額" value={yen(totalPay)} accent />
            </div>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left font-semibold px-4 py-3">スタッフ</th>
                      <th className="text-right font-semibold px-4 py-3">出勤日数</th>
                      <th className="text-right font-semibold px-4 py-3">実働時間</th>
                      <th className="text-right font-semibold px-4 py-3">時給</th>
                      <th className="text-right font-semibold px-4 py-3">概算支給額</th>
                      <th className="text-right font-semibold px-4 py-3">打刻もれ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.user_id} className="border-t border-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-800">{r.staff_name}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{r.days}日</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-800">{r.totalHm}</td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {r.hourlyRate != null ? `¥${r.hourlyRate.toLocaleString()}` : <span className="text-gray-300">未設定</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800">
                          {r.estimatedPay != null ? yen(r.estimatedPay) : <span className="text-gray-300 font-normal">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.missingClockOut > 0 ? (
                            <span className="text-amber-600 font-bold">{r.missingClockOut}</span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              ※ 実働時間は各日の最初の出勤打刻〜最後の退勤打刻から算出。概算支給額は「実働時間 × 契約の時給」で、
              <span className="font-semibold">休憩控除・残業割増・深夜手当は未考慮</span>です。給与計算の一次集計としてご利用ください。
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl shadow p-4 ${accent ? "bg-[#06C755] text-white" : "bg-white"}`}>
      <p className={`text-xs ${accent ? "text-green-100" : "text-gray-400"}`}>{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent ? "text-white" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}
