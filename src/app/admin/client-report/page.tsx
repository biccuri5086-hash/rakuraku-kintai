"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, LogOut, Download, Building2 } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Staff = { user_id: string; staff_name: string; days: number; grossMin: number; grossHm: string };
type ClientBlock = {
  client_id: string | null;
  client_name: string;
  totalDays: number;
  totalGrossMin: number;
  totalGrossHm: string;
  staff: Staff[];
};

function thisMonth(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

export default function ClientReportPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [month, setMonth] = useState(thisMonth());
  const [clients, setClients] = useState<ClientBlock[]>([]);
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
    const res = await fetch(`/api/admin/payroll/client-report?month=${month}`, { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setClients(data.ok ? data.clients : []);
    setLoading(false);
  }, [month, router]);

  useEffect(() => {
    if (authed) fetchReport();
  }, [authed, fetchReport]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  const downloadCsv = (clientId: string | null) => {
    const q = clientId ? `&client_id=${encodeURIComponent(clientId)}` : "";
    window.location.href = `/api/admin/payroll/client-report?month=${month}&format=csv${q}`;
  };

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
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p className="text-xs text-green-100">派遣先向け 勤怠報告</p>
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
            <ClipboardList size={18} className="text-[#06C755]" /> 派遣先別 就業実績
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
            />
            <button
              onClick={() => downloadCsv(null)}
              disabled={clients.length === 0}
              className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] disabled:opacity-50 transition-colors"
            >
              <Download size={16} /> 全件CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : clients.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <ClipboardList size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">この月の就業記録がありません</p>
          </div>
        ) : (
          clients.map((c) => (
            <div key={c.client_id ?? "unassigned"} className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 size={16} className="text-[#06C755] flex-shrink-0" />
                  <span className="font-bold text-gray-800 truncate">{c.client_name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {c.staff.length}名・{c.totalDays}日・{c.totalGrossHm}
                  </span>
                </div>
                <button
                  onClick={() => downloadCsv(c.client_id)}
                  className="flex items-center gap-1 text-[#06C755] text-xs font-bold px-2 py-1.5 rounded-lg hover:bg-green-50 transition-colors flex-shrink-0"
                  title="この派遣先の報告をCSVで出力"
                >
                  <Download size={14} /> CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left font-semibold px-4 py-2.5">スタッフ</th>
                      <th className="text-right font-semibold px-4 py-2.5">就業日数</th>
                      <th className="text-right font-semibold px-4 py-2.5">就業時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.staff.map((s) => (
                      <tr key={s.user_id} className="border-t border-gray-50">
                        <td className="px-4 py-2.5 font-semibold text-gray-800">{s.staff_name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{s.days}日</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-800">{s.grossHm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
        <p className="text-xs text-gray-400">
          ※ 就業時間は<span className="font-semibold">拘束（出勤〜退勤）</span>ベースです。打刻を契約（派遣先）に紐づけて集計しています。
          契約が未割当の打刻は「（契約未割当）」にまとめています。
        </p>
      </main>
    </div>
  );
}
