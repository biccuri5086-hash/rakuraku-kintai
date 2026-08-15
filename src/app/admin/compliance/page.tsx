"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, LogOut, Download, AlertTriangle, Clock, HelpCircle, Check, Building2, User } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Level = "ok" | "warn" | "expired" | "unknown";
type Alert = {
  scope: "office" | "individual";
  level: Level;
  client_id: string | null;
  client_name: string;
  staff_id?: string;
  staff_name?: string;
  org_unit?: string | null;
  limitDate: string | null;
  daysRemaining: number | null;
  basis: string;
};
type LedgerRow = {
  staff_name: string; client_name: string; org_unit: string | null; job_content: string | null;
  type: string; start_date: string; end_date: string | null; individualLimit: string | null; officeLimit: string | null;
};

const LEVEL_UI: Record<Level, { label: string; cls: string; icon: typeof AlertTriangle }> = {
  expired: { label: "超過", cls: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle },
  warn: { label: "要注意", cls: "bg-amber-50 text-amber-800 border-amber-200", icon: Clock },
  unknown: { label: "未設定", cls: "bg-gray-50 text-gray-500 border-gray-200", icon: HelpCircle },
  ok: { label: "余裕あり", cls: "bg-green-50 text-[#06C755] border-green-200", icon: Check },
};

export default function CompliancePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [counts, setCounts] = useState<{ expired: number; warn: number; unknown: number }>({ expired: 0, warn: 0, unknown: 0 });
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [ackMsg, setAckMsg] = useState<string | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.ok) { setAuthed(true); setCompanyName(data.company?.name ?? "ラクラク勤怠"); }
        else router.replace("/admin/login");
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [aRes, lRes] = await Promise.all([
      fetch("/api/admin/compliance/alerts", { cache: "no-store" }),
      fetch("/api/admin/compliance/ledger", { cache: "no-store" }),
    ]);
    if (aRes.status === 401) { router.replace("/admin/login"); return; }
    const aData = await aRes.json();
    const lData = await lRes.json().catch(() => ({}));
    setAlerts(aData.ok ? aData.alerts : []);
    setCounts(aData.ok ? aData.counts : { expired: 0, warn: 0, unknown: 0 });
    setLedger(lData.ok ? lData.rows : []);
    setLoading(false);
  }, [router]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  const keyOf = (a: Alert) => `${a.scope}|${a.client_id}|${a.staff_id ?? ""}|${a.org_unit ?? ""}`;

  const ack = async (a: Alert) => {
    setAckMsg(null);
    const res = await fetch("/api/admin/compliance/ack", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: a.scope, client_id: a.client_id, user_id: a.staff_id, org_unit: a.org_unit, limit_date: a.limitDate }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) setAcked((m) => ({ ...m, [keyOf(a)]: true }));
    else setAckMsg(data.message ?? "記録に失敗しました");
  };

  if (!authed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">権限確認中...</p>
      </div>
    );
  }

  const actionable = alerts.filter((a) => a.level === "expired" || a.level === "warn" || a.level === "unknown");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p className="text-xs text-green-100">派遣法コンプラ（抵触日・管理台帳）</p>
        </div>
        <button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); router.replace("/admin/login"); }}
          title="ログアウト" className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
          <LogOut size={18} />
        </button>
      </header>

      <AdminNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <h2 className="font-bold text-gray-700 flex items-center gap-2">
          <ShieldAlert size={18} className="text-[#06C755]" /> 抵触日アラート
        </h2>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="超過" value={counts.expired} tone="red" />
          <Stat label="要注意(90日以内)" value={counts.warn} tone="amber" />
          <Stat label="未設定" value={counts.unknown} tone="gray" />
        </div>

        {ackMsg && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{ackMsg}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : actionable.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-10 text-gray-400">
            <Check size={28} className="mx-auto mb-2 text-[#06C755]" />
            <p className="text-sm">対応が必要な抵触日はありません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {actionable.map((a) => {
              const ui = LEVEL_UI[a.level];
              const Icon = ui.icon;
              const done = acked[keyOf(a)];
              return (
                <div key={keyOf(a)} className={`bg-white rounded-xl shadow border-l-4 ${a.level === "expired" ? "border-red-400" : a.level === "warn" ? "border-amber-400" : "border-gray-300"} px-4 py-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${ui.cls} inline-flex items-center gap-1`}>
                          <Icon size={12} /> {ui.label}
                        </span>
                        <span className="text-xs text-gray-400 inline-flex items-center gap-1">
                          {a.scope === "office" ? <><Building2 size={12} /> 事業所単位</> : <><User size={12} /> 個人単位</>}
                        </span>
                      </div>
                      <p className="font-bold text-gray-800 mt-1 truncate">
                        {a.client_name}
                        {a.staff_name && <span className="text-gray-500 font-normal"> ／ {a.staff_name}</span>}
                        {a.org_unit && <span className="text-gray-400 font-normal text-xs">（{a.org_unit}）</span>}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        抵触日 <span className="font-mono">{a.limitDate ?? "未設定"}</span>
                        {a.daysRemaining != null && (
                          <span className={a.daysRemaining < 0 ? "text-red-600 font-bold" : "text-amber-700"}>
                            {" "}（{a.daysRemaining < 0 ? `${-a.daysRemaining}日超過` : `残り${a.daysRemaining}日`}）
                          </span>
                        )}
                        <span className="text-gray-300"> · {a.basis}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => ack(a)}
                      disabled={done}
                      className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${done ? "bg-green-50 text-[#06C755]" : "bg-gray-800 text-white hover:bg-gray-700"}`}
                    >
                      {done ? "対応済み" : "対応記録"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button onClick={() => setShowLedger((v) => !v)} className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <ShieldAlert size={16} className="text-gray-400" /> 派遣元管理台帳 {showLedger ? "▲" : "▼"}
          </button>
          <button
            onClick={() => (window.location.href = "/api/admin/compliance/ledger?format=csv")}
            disabled={ledger.length === 0}
            className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] disabled:opacity-50 transition-colors"
          >
            <Download size={16} /> 台帳CSV
          </button>
        </div>

        {showLedger && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="text-left font-semibold px-3 py-2.5">派遣先</th>
                    <th className="text-left font-semibold px-3 py-2.5">スタッフ</th>
                    <th className="text-left font-semibold px-3 py-2.5">種別</th>
                    <th className="text-left font-semibold px-3 py-2.5">期間</th>
                    <th className="text-left font-semibold px-3 py-2.5">個人抵触日</th>
                    <th className="text-left font-semibold px-3 py-2.5">事業所抵触日</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-2.5 font-semibold text-gray-800">{r.client_name}</td>
                      <td className="px-3 py-2.5 text-gray-700">{r.staff_name}</td>
                      <td className="px-3 py-2.5 text-gray-500">{r.type === "ongoing" ? "中長期" : "単発"}</td>
                      <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{r.start_date}〜{r.end_date ?? ""}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-700">{r.individualLimit ?? <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-700">{r.officeLimit ?? <span className="text-gray-300">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 text-xs text-gray-500 space-y-1">
          <p>※ 事業所抵触日は「延長後 ＞ 事業所抵触日（派遣先設定）＞ 受入開始日＋3年」の順で採用します。</p>
          <p>※ 個人抵触日は「同一の派遣先・組織単位での中長期派遣の開始＋3年」で算出（クーリング期間は未考慮）。正確な運用は<span className="font-semibold">派遣先での受入開始日・組織単位</span>の登録で精度が上がります。</p>
          <p>※「対応記録」は派遣法テーブル（PHASE_C_MIGRATION.sql）の適用後に保存されます。</p>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "gray" }) {
  const cls = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-gray-500";
  return (
    <div className="bg-white rounded-2xl shadow p-4 text-center">
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  );
}
