"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Wallet, LogOut, Download, AlertTriangle, Settings, CheckCircle, Lock, ChevronRight, ChevronDown } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type DayEntry = {
  date: string;
  inAt: string | null;
  outAt: string | null;
  grossMin: number;
  breakMin: number;
  workMin: number;
  overtimeMin: number;
  nightMin: number;
  holidayMin: number;
  isStatutoryHoliday: boolean;
  flags: string[];
};

type Row = {
  user_id: string;
  staff_name: string;
  workedDays: number;
  workMin: number;
  overtimeMin: number;
  nightMin: number;
  holidayMin: number;
  paidMin: number;
  paidHm: string;
  hourlyRate: number | null;
  estimatedPay: number | null;
  needsReview: boolean;
  ratesMixed: boolean;
  entries: DayEntry[];
};

type Totals = {
  workMin: number;
  overtimeMin: number;
  nightMin: number;
  holidayMin: number;
  estimatedPay: number;
};

function thisMonth(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// ISO → JSTの HH:MM（打刻時刻表示用）
function hhmm(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(11, 16);
}

// "YYYY-MM-DD" → "M/D(曜)"
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
function mdDow(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}

export default function PayrollPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsSource, setSettingsSource] = useState<"db" | "default">("default");
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/payroll/preview?month=${month}`, { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setRows(data.ok ? data.rows : []);
    setTotals(data.ok ? data.totals : null);
    setSettingsSource(data.ok ? data.settingsSource : "default");
    setLoading(false);
  }, [month, router]);

  const fetchConfirmStatus = useCallback(async () => {
    const res = await fetch(`/api/admin/payroll/confirm?month=${month}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setConfirmedAt(data.ok && data.available && data.confirmedCount > 0 ? data.confirmedAt : null);
  }, [month]);

  useEffect(() => {
    if (authed) {
      fetchPreview();
      fetchConfirmStatus();
    }
  }, [authed, fetchPreview, fetchConfirmStatus]);

  const confirmMonth = async () => {
    setConfirming(true);
    setConfirmMsg(null);
    const res = await fetch("/api/admin/payroll/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      setConfirmedAt(data.confirmedAt);
      setConfirmMsg(`${data.confirmed}名分を締めました`);
    } else {
      setConfirmMsg(data.message ?? "締めに失敗しました");
    }
    setConfirming(false);
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  const downloadCsv = () => {
    window.location.href = `/api/admin/payroll/preview?month=${month}&format=csv`;
  };

  if (!authed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">権限確認中...</p>
      </div>
    );
  }

  const reviewCount = rows.filter((r) => r.needsReview).length;
  const yen = (n: number) => `¥${n.toLocaleString()}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p className="text-xs text-green-100">給与集計（締めプレビュー）</p>
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

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-gray-700 flex items-center gap-2">
            <Wallet size={18} className="text-[#06C755]" /> 給与集計プレビュー
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/admin/payroll/settings")}
              title="集計の設定（締め日・割増・丸め・休日）"
              className="flex items-center gap-1 border border-gray-200 text-gray-500 text-sm px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Settings size={16} /> 設定
            </button>
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

        <div className="flex items-center justify-between gap-2 flex-wrap bg-white rounded-xl shadow px-4 py-3">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            {confirmedAt ? (
              <>
                <CheckCircle size={16} className="text-[#06C755]" />
                <span>この月は<span className="font-bold text-gray-800">締め確定済み</span>（{new Date(confirmedAt).toLocaleString("ja-JP")}）</span>
              </>
            ) : (
              <>
                <Lock size={16} className="text-gray-400" />
                <span>この月はまだ締めていません（下の集計は確認用のプレビューです）</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {confirmMsg && <span className="text-xs text-gray-500">{confirmMsg}</span>}
            <button
              onClick={confirmMonth}
              disabled={confirming || rows.length === 0}
              className="flex items-center gap-1 bg-gray-800 text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={16} /> {confirming ? "締め中..." : confirmedAt ? "再締め" : "この月を締める"}
            </button>
          </div>
        </div>

        {settingsSource === "default" && (
          <p className="text-xs text-gray-400">
            ※ 集計は初期設定（締め日=末日・法定休日=日曜・丸め1分など）で計算中です。
            <button onClick={() => router.push("/admin/payroll/settings")} className="text-[#06C755] font-semibold underline underline-offset-2">設定</button>
            から会社に合わせて変更できます。
          </p>
        )}

        {reviewCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span>
              打刻漏れなどで <span className="font-bold">{reviewCount}名</span> に確認が必要な日があります。該当日は集計から除外しています（確認後に締めてください）。
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <Wallet size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">この月の勤怠記録がありません</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard label="対象スタッフ" value={`${rows.length}名`} />
              <SummaryCard label="実働＋残業" value={hm((totals?.workMin ?? 0) + (totals?.overtimeMin ?? 0))} />
              <SummaryCard label="うち残業" value={hm(totals?.overtimeMin ?? 0)} />
              <SummaryCard label="概算支給額" value={yen(totals?.estimatedPay ?? 0)} accent />
            </div>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left font-semibold px-4 py-3">スタッフ</th>
                      <th className="text-right font-semibold px-3 py-3">出勤</th>
                      <th className="text-right font-semibold px-3 py-3">法定内</th>
                      <th className="text-right font-semibold px-3 py-3">残業</th>
                      <th className="text-right font-semibold px-3 py-3">深夜</th>
                      <th className="text-right font-semibold px-3 py-3">法定休日</th>
                      <th className="text-right font-semibold px-3 py-3">時給</th>
                      <th className="text-right font-semibold px-4 py-3">概算支給額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const open = expanded === r.user_id;
                      return (
                      <Fragment key={r.user_id}>
                      <tr
                        className="border-t border-gray-50 hover:bg-gray-50/60 cursor-pointer"
                        onClick={() => setExpanded(open ? null : r.user_id)}
                      >
                        <td className="px-4 py-3 font-semibold text-gray-800">
                          <span className="flex items-center gap-1.5">
                            {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                            {r.staff_name}
                            {r.needsReview && (
                              <AlertTriangle size={13} className="text-amber-500" aria-label="要確認" />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-gray-600">{r.workedDays}日</td>
                        <td className="px-3 py-3 text-right font-mono text-gray-800">{hm(r.workMin)}</td>
                        <td className="px-3 py-3 text-right font-mono text-gray-600">
                          {r.overtimeMin > 0 ? hm(r.overtimeMin) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-600">
                          {r.nightMin > 0 ? hm(r.nightMin) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-600">
                          {r.holidayMin > 0 ? hm(r.holidayMin) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-500">
                          {r.hourlyRate != null ? (
                            `¥${r.hourlyRate.toLocaleString()}`
                          ) : r.ratesMixed ? (
                            <span title="月内で複数の派遣先/時給が混在（各日の明細を確認）">複数</span>
                          ) : (
                            <span className="text-gray-300">未設定</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800">
                          {r.estimatedPay != null ? yen(r.estimatedPay) : <span className="text-gray-300 font-normal">-</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-gray-50/50">
                          <td colSpan={8} className="px-4 py-3">
                            <DayBreakdown entries={r.entries} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 text-xs text-gray-500 space-y-1">
              <p>
                ※ 実働＝拘束−休憩（シフト休憩があれば優先、無ければ労基法の最低基準 6h超45分／8h超60分を控除）。
                残業＝日8時間・週40時間の超過、深夜＝22:00〜5:00の割増対象、法定休日は日曜（会社設定で変更予定）。
              </p>
              <p>
                ※ <span className="font-semibold text-gray-700">概算支給額</span>は
                「実働×時給＋残業×1.25＋深夜割増＋法定休日×1.35」の
                <span className="font-semibold">目安</span>です。正式な給与計算（社会保険・税・控除）は給与ソフトで行ってください。
              </p>
              <p>
                ※ 打刻漏れ（退勤なし）の日は<span className="font-semibold text-amber-600">要確認</span>として集計から除外しています。
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function DayBreakdown({ entries }: { entries: DayEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-gray-400">この月の打刻はありません。</p>;
  }
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead>
          <tr className="text-gray-400">
            <th className="text-left font-semibold px-3 py-2">日付</th>
            <th className="text-left font-semibold px-3 py-2">出退勤</th>
            <th className="text-right font-semibold px-3 py-2">休憩</th>
            <th className="text-right font-semibold px-3 py-2">法定内</th>
            <th className="text-right font-semibold px-3 py-2">残業</th>
            <th className="text-right font-semibold px-3 py-2">深夜</th>
            <th className="text-right font-semibold px-3 py-2">法定休日</th>
            <th className="text-left font-semibold px-3 py-2">状態</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const missing = e.flags.includes("missing_punch");
            const review = missing || e.flags.includes("needs_review");
            return (
              <tr key={e.date} className={`border-t border-gray-50 ${review ? "bg-amber-50/50" : ""}`}>
                <td className="px-3 py-2 text-gray-700">
                  {mdDow(e.date)}
                  {e.isStatutoryHoliday && <span className="ml-1 text-[10px] text-red-500 font-bold">法休</span>}
                </td>
                <td className="px-3 py-2 font-mono text-gray-600">
                  {hhmm(e.inAt)}〜{hhmm(e.outAt)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">{e.breakMin > 0 ? `${e.breakMin}分` : "-"}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{e.workMin > 0 ? hm(e.workMin) : "-"}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{e.overtimeMin > 0 ? hm(e.overtimeMin) : "-"}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{e.nightMin > 0 ? hm(e.nightMin) : "-"}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{e.holidayMin > 0 ? hm(e.holidayMin) : "-"}</td>
                <td className="px-3 py-2">
                  {missing ? (
                    <span className="text-amber-600 font-bold">退勤打刻なし（除外）</span>
                  ) : review ? (
                    <span className="text-amber-600 font-bold">要確認</span>
                  ) : (
                    <span className="text-gray-300">OK</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
