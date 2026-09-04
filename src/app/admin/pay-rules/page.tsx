"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BadgeJapaneseYen, LogOut, Plus, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Scope = "company" | "client" | "assignment";

type RuleRow = {
  id: string;
  scope: Scope;
  clientId: string | null;
  assignmentId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  baseHourlyRate: number | null;
  overtimeRate: number;
  overtime60Rate: number;
  nightRate: number;
  holidayRate: number;
  status: "past" | "current" | "future";
};

type ChainLink = {
  scope: Scope;
  rule: { id: string; baseHourlyRate: number | null; overtimeRate: number; overtime60Rate: number; nightRate: number; holidayRate: number } | null;
  isWinner: boolean;
};

type ClientOpt = { id: string; name: string };
type AssignmentOpt = { id: string; client_name: string; staff_name: string; hourly_rate: number | null };

const SCOPE_LABEL: Record<Scope, string> = { company: "会社全体", client: "派遣先ごと", assignment: "契約(スタッフ)ごと" };

const DRAFT_DEFAULT = { effectiveFrom: "", baseHourlyRate: "", overtimeRate: "1.25", overtime60Rate: "1.5", nightRate: "1.25", holidayRate: "1.35" };

function fmtYen(n: number | null): string {
  return n == null ? "—" : `¥${n.toLocaleString()}`;
}

export default function PayRulesPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");

  const [scope, setScope] = useState<Scope>("assignment");
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [assignments, setAssignments] = useState<AssignmentOpt[]>([]);
  const [targetId, setTargetId] = useState<string>("");

  const [rules, setRules] = useState<RuleRow[]>([]);
  const [chain, setChain] = useState<ChainLink[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ ...DRAFT_DEFAULT });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState<{
    currentRate: number | null; newRate: number | null; changePercent: number | null; previewToken: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.ok) { setAuthed(true); setCompanyName(data.company?.name ?? "ラクラク勤怠"); }
        else router.replace("/admin/login");
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  // 対象ピッカー用の一覧（既存API流用。新規エンドポイントは作らない）
  useEffect(() => {
    if (!authed) return;
    fetch("/api/admin/clients", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.ok) setClients(d.clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    });
    fetch("/api/admin/assignments", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.ok) {
        setAssignments(
          d.assignments.map((a: { id: string; staff_name: string; client_name: string; hourly_rate: number | null }) => ({
            id: a.id, staff_name: a.staff_name, client_name: a.client_name, hourly_rate: a.hourly_rate,
          }))
        );
      }
    });
  }, [authed]);

  const target = useMemo(() => {
    if (scope === "client") return clients.find((c) => c.id === targetId) ?? null;
    if (scope === "assignment") return assignments.find((a) => a.id === targetId) ?? null;
    return null;
  }, [scope, targetId, clients, assignments]);

  const load = useCallback(async () => {
    if (scope !== "company" && !targetId) { setRules([]); setChain(null); return; }
    setLoading(true);
    const q = scope === "company" ? `scope=company` : `scope=${scope}&targetId=${targetId}`;
    const res = await fetch(`/api/admin/pay-rules?${q}`, { cache: "no-store" });
    if (res.status === 401) { router.replace("/admin/login"); return; }
    const data = await res.json();
    setRules(data.ok ? data.rules : []);

    if (scope === "assignment" && targetId) {
      const cRes = await fetch(`/api/admin/pay-rules/effective?assignmentId=${targetId}`, { cache: "no-store" });
      const cData = await cRes.json();
      setChain(cData.ok ? cData.chain : null);
    } else {
      setChain(null);
    }
    setLoading(false);
  }, [scope, targetId, router]);

  useEffect(() => { load(); }, [load]);

  const openForm = () => {
    // 現在有効な値をプリフィルする（時給だけ変えたつもりで割増率がリセットされる事故を防ぐ）
    const currentOpen = rules.find((r) => r.status === "current");
    const winnerLink = chain?.find((l) => l.isWinner)?.rule;
    const base = winnerLink ?? currentOpen ?? null;
    // 契約スコープでルールが1件も無ければ、契約の素の時給(assignments.hourly_rate)を初期値にする
    const assignmentFallback = scope === "assignment" && target && "hourly_rate" in target ? (target as AssignmentOpt).hourly_rate : null;
    const currentHourly = base?.baseHourlyRate ?? assignmentFallback;
    setDraft({
      effectiveFrom: "",
      baseHourlyRate: currentHourly != null ? String(currentHourly) : "",
      overtimeRate: String(base?.overtimeRate ?? 1.25),
      overtime60Rate: String(base?.overtime60Rate ?? 1.5),
      nightRate: String(base?.nightRate ?? 1.25),
      holidayRate: String(base?.holidayRate ?? 1.35),
    });
    setError(null);
    setConfirmStep(null);
    setShowForm(true);
  };

  const submitPreview = async () => {
    setError(null);
    const effectiveFrom = draft.effectiveFrom.trim();
    if (!effectiveFrom) { setError("開始日を入力してください"); return; }
    const body = {
      scope,
      clientId: scope === "client" ? targetId : null,
      assignmentId: scope === "assignment" ? targetId : null,
      effectiveFrom,
      baseHourlyRate: draft.baseHourlyRate.trim() === "" ? null : Number(draft.baseHourlyRate),
      overtimeRate: Number(draft.overtimeRate),
      overtime60Rate: Number(draft.overtime60Rate),
      nightRate: Number(draft.nightRate),
      holidayRate: Number(draft.holidayRate),
    };
    setSaving(true);
    const res = await fetch("/api/admin/pay-rules/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!data.ok) { setError(data.message ?? "確認に失敗しました"); return; }

    if (data.needsConfirmation) {
      setConfirmStep({ currentRate: data.currentRate, newRate: data.newRate, changePercent: data.changePercent, previewToken: data.previewToken });
    } else {
      await commit(data.previewToken);
    }
  };

  const commit = async (previewToken: string) => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/pay-rules/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewToken }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!data.ok) { setError(data.message ?? "予約に失敗しました"); return; }
    setShowForm(false);
    setConfirmStep(null);
    setDraft({ ...DRAFT_DEFAULT });
    load();
  };

  const cancelFutureRule = async (id: string) => {
    if (!confirm("この改定予約を取消しますか？")) return;
    const res = await fetch(`/api/admin/pay-rules/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) { alert(data.message ?? "取消に失敗しました"); return; }
    load();
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
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
          <p className="text-xs text-green-100">賃率ルール管理</p>
        </div>
        <button onClick={handleLogout} title="ログアウト" className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
          <LogOut size={18} />
        </button>
      </header>

      <AdminNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <h2 className="font-bold text-gray-700 flex items-center gap-2">
          <BadgeJapaneseYen size={18} className="text-[#06C755]" /> 賃率・残業ルール
        </h2>

        {/* スコープ選択 */}
        <div className="flex gap-2">
          {(["assignment", "client", "company"] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => { setScope(s); setTargetId(""); setShowForm(false); }}
              className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors ${
                scope === s ? "bg-[#06C755] text-white" : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>

        {/* 対象ピッカー */}
        {scope === "client" && (
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
          >
            <option value="">派遣先を選択してください</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {scope === "assignment" && (
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
          >
            <option value="">契約を選択してください</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>{a.staff_name} @ {a.client_name}（初期時給 {a.hourly_rate != null ? `¥${a.hourly_rate.toLocaleString()}` : "未設定"}）</option>
            ))}
          </select>
        )}

        {(scope === "company" || targetId) && (
          <>
            {/* 継承チェーン可視化（契約スコープのみ） */}
            {scope === "assignment" && chain && (
              <div className="bg-white rounded-2xl shadow p-4">
                <p className="text-xs font-bold text-gray-400 mb-3">現在適用中のルール</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {chain.map((link, i) => (
                    <div key={link.scope} className="flex items-center gap-2">
                      {i > 0 && <span className="text-gray-300">→</span>}
                      <div
                        className={`px-3 py-2 rounded-lg text-sm border ${
                          link.isWinner ? "bg-green-50 border-[#06C755] text-green-700 font-bold" : "bg-gray-50 border-gray-200 text-gray-400"
                        }`}
                      >
                        {SCOPE_LABEL[link.scope]}
                        <div className="text-xs mt-0.5">{link.rule ? fmtYen(link.rule.baseHourlyRate) : "ルール無し"}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {chain.find((l) => l.isWinner) && chain.find((l) => l.isWinner)!.scope !== "assignment" && (
                  <p className="text-xs text-gray-400 mt-3">
                    ※ この契約に個別ルールは無いため、{SCOPE_LABEL[chain.find((l) => l.isWinner)!.scope]}のルールが適用されています
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">履歴（新しい順）</p>
              <button
                onClick={openForm}
                className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] transition-colors"
              >
                <Plus size={16} /> 改定を予約する
              </button>
            </div>

            {showForm && (
              <div className="bg-white rounded-2xl shadow p-4 space-y-3">
                {!confirmStep ? (
                  <>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <Field label="変更後の開始日 *" type="date" value={draft.effectiveFrom} onChange={(v) => setDraft({ ...draft, effectiveFrom: v })} />
                    <Field label="時給（円・未入力なら現状維持）" value={draft.baseHourlyRate} onChange={(v) => setDraft({ ...draft, baseHourlyRate: v.replace(/[^\d]/g, "") })} placeholder="1300" />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="残業割増率" value={draft.overtimeRate} onChange={(v) => setDraft({ ...draft, overtimeRate: v })} />
                      <Field label="60h超割増率" value={draft.overtime60Rate} onChange={(v) => setDraft({ ...draft, overtime60Rate: v })} />
                      <Field label="深夜割増率" value={draft.nightRate} onChange={(v) => setDraft({ ...draft, nightRate: v })} />
                      <Field label="法定休日割増率" value={draft.holidayRate} onChange={(v) => setDraft({ ...draft, holidayRate: v })} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={submitPreview} disabled={saving} className="flex-1 bg-[#06C755] text-white font-bold py-2.5 rounded-lg hover:bg-[#05b34c] disabled:opacity-60 transition-colors">
                        {saving ? "確認中..." : "予約内容を確認"}
                      </button>
                      <button onClick={() => setShowForm(false)} className="px-4 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <AlertTriangle size={18} className="text-orange-500 shrink-0 mt-0.5" />
                      <div className="text-sm text-orange-800">
                        <p className="font-bold">時給が大きく変わります</p>
                        <p className="mt-1">
                          現在: {fmtYen(confirmStep.currentRate)} → 変更後: {fmtYen(confirmStep.newRate)}
                          {confirmStep.changePercent != null && (
                            <span className="ml-1">（{confirmStep.changePercent >= 0 ? "+" : ""}{confirmStep.changePercent.toFixed(1)}%）</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs">入力ミスでないか確認してください。</p>
                      </div>
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmStep(null)} className="flex-1 border border-gray-200 text-gray-600 font-bold py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                        修正する
                      </button>
                      <button
                        onClick={() => commit(confirmStep.previewToken)}
                        disabled={saving}
                        className="flex-1 bg-orange-500 text-white font-bold py-2.5 rounded-lg hover:bg-orange-600 disabled:opacity-60 transition-colors"
                      >
                        {saving ? "保存中..." : "この内容で確定"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : rules.length === 0 ? (
              <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
                <BadgeJapaneseYen size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm">まだルールがありません</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((r) => (
                  <div key={r.id} className="bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-800">{r.effectiveFrom} 〜 {r.effectiveTo ?? ""}</span>
                        {r.status === "current" && (
                          <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                            <CheckCircle2 size={10} /> 現在
                          </span>
                        )}
                        {r.status === "future" && (
                          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">予約中</span>
                        )}
                        {r.status === "past" && (
                          <span className="text-[10px] font-bold bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">過去</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        時給{fmtYen(r.baseHourlyRate)}　残業{r.overtimeRate}　60h超{r.overtime60Rate}　深夜{r.nightRate}　休日{r.holidayRate}
                      </p>
                    </div>
                    {r.status === "future" && (
                      <button onClick={() => cancelFutureRule(r.id)} className="text-gray-300 hover:text-red-500 transition-colors text-xs font-bold">
                        取消
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/30"
      />
    </label>
  );
}
