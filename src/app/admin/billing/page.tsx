"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, LogOut, Check, Users, Info } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type PlanId = "trial" | "free" | "starter" | "standard" | "enterprise";
type PlanView = {
  id: PlanId; name: string; unitPrice: number | null; features: string[]; note?: string; estimate: number | null;
};
type Sub = { plan: PlanId; status: "trial" | "active" | "free"; trialEndsOn: string | null };

const STATUS_LABEL: Record<Sub["status"], string> = { trial: "トライアル中", active: "契約中", free: "無料プラン" };

export default function BillingPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [sub, setSub] = useState<Sub | null>(null);
  const [source, setSource] = useState<"db" | "default">("default");
  const [staffCount, setStaffCount] = useState(0);
  const [currentEstimate, setCurrentEstimate] = useState<number | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PlanId | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

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
    const res = await fetch("/api/admin/billing", { cache: "no-store" });
    if (res.status === 401) { router.replace("/admin/login"); return; }
    const data = await res.json();
    if (data.ok) {
      setSub(data.subscription); setSource(data.source); setStaffCount(data.staffCount);
      setCurrentEstimate(data.currentEstimate); setPlans(data.plans);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  const choose = async (plan: PlanId) => {
    setSaving(plan); setMsg(null);
    const res = await fetch("/api/admin/billing", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { setMsg({ kind: "ok", text: "プランを変更しました" }); await load(); }
    else setMsg({ kind: "err", text: data.message ?? "変更に失敗しました" });
    setSaving(null);
  };

  const yen = (n: number) => `¥${n.toLocaleString()}`;

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
          <p className="text-xs text-green-100">プラン・料金</p>
        </div>
        <button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); router.replace("/admin/login"); }}
          title="ログアウト" className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
          <LogOut size={18} />
        </button>
      </header>

      <AdminNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <h2 className="font-bold text-gray-700 flex items-center gap-2">
          <CreditCard size={18} className="text-[#06C755]" /> 現在のプラン
        </h2>

        {loading || !sub ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="bg-[#06C755] text-white rounded-2xl shadow p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-green-100">{STATUS_LABEL[sub.status]}</p>
                  <p className="text-2xl font-bold mt-0.5">{plans.find((p) => p.id === sub.plan)?.name ?? sub.plan}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-green-100 flex items-center gap-1 justify-end"><Users size={12} /> 登録スタッフ {staffCount}名</p>
                  <p className="text-2xl font-bold mt-0.5">
                    {currentEstimate == null ? "要見積" : `${yen(currentEstimate)}`}<span className="text-sm font-normal">/月（概算）</span>
                  </p>
                </div>
              </div>
              {source === "default" && (
                <p className="text-[11px] text-green-100 mt-3">
                  ※ まだプランが保存されていません（トライアル既定で表示）。保存には課金テーブル（PHASE_D_BILLING_MIGRATION.sql）の適用が必要です。
                </p>
              )}
            </div>

            {msg && (
              <div className={`rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-green-50 text-[#06C755] border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {msg.text}
              </div>
            )}

            <h3 className="font-bold text-gray-700 text-sm pt-1">プランを選ぶ</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {plans.filter((p) => p.id !== "trial").map((p) => {
                const current = p.id === sub.plan;
                return (
                  <div key={p.id} className={`bg-white rounded-2xl shadow p-4 flex flex-col ${current ? "ring-2 ring-[#06C755]" : ""}`}>
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-gray-800">{p.name}</p>
                      {current && <span className="text-[11px] font-bold text-[#06C755] bg-green-50 px-2 py-0.5 rounded-full">利用中</span>}
                    </div>
                    <p className="mt-1 text-gray-800">
                      {p.unitPrice == null ? <span className="font-bold">要お見積り</span> : p.unitPrice === 0 ? <span className="font-bold">無料</span> : <><span className="text-xl font-bold">{yen(p.unitPrice)}</span><span className="text-xs text-gray-400"> /人・月</span></>}
                    </p>
                    {p.estimate != null && p.unitPrice ? (
                      <p className="text-xs text-gray-500">{staffCount}名で概算 {yen(p.estimate)}/月</p>
                    ) : null}
                    <ul className="mt-2 space-y-1 flex-1">
                      {p.features.map((f, i) => (
                        <li key={i} className="text-xs text-gray-600 flex items-start gap-1"><Check size={13} className="text-[#06C755] flex-shrink-0 mt-0.5" /> {f}</li>
                      ))}
                    </ul>
                    {p.note && <p className="text-[11px] text-gray-400 mt-2">{p.note}</p>}
                    <button
                      onClick={() => choose(p.id)}
                      disabled={current || saving !== null}
                      className={`mt-3 text-sm font-bold py-2 rounded-lg transition-colors ${current ? "bg-gray-100 text-gray-400" : "bg-[#06C755] text-white hover:bg-[#05b34c]"} disabled:opacity-60`}
                    >
                      {current ? "利用中" : saving === p.id ? "変更中..." : p.id === "enterprise" ? "このプランにする（要相談）" : "このプランにする"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 text-xs text-gray-500 flex items-start gap-2">
              <Info size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
              <div className="space-y-1">
                <p>料金は登録スタッフ数×単価の概算です（前月末の登録数で翌月分を請求）。月単位契約・違約金なし。</p>
                <p>トライアルは30日・全機能。終了後は無料プラン（打刻のみ）へ移行します。</p>
                <p>※ 実際の決済（カード・請求書）連携は本画面では未対応です。プラン状態の管理のみ行います。</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
