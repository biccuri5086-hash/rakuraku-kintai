"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import { CalendarHeart, LogOut, Plus, Minus, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Grant = { id: string; granted_days: number; grant_date: string; expires_on: string; note: string | null };
type Taking = { id: string; taken_date: string; days: number; note: string | null };
type Row = {
  user_id: string;
  staff_name: string;
  grantedActive: number;
  takenTotal: number;
  remaining: number;
  nextExpiry: string | null;
  grants: Grant[];
  takings: Taking[];
};
type StaffOption = { user_id: string; name: string };

function today(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function PaidLeavePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [rows, setRows] = useState<Row[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "grant" | "take">("none");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // フォーム
  const [userId, setUserId] = useState("");
  const [grantDays, setGrantDays] = useState("10");
  const [grantDate, setGrantDate] = useState(today());
  const [takeDate, setTakeDate] = useState(today());
  const [takeDays, setTakeDays] = useState("1");
  const [note, setNote] = useState("");

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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [plRes, stRes] = await Promise.all([
      fetch("/api/admin/paid-leave", { cache: "no-store" }),
      fetch("/api/admin/staff", { cache: "no-store" }),
    ]);
    if (plRes.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const pl = await plRes.json();
    const st = await stRes.json();
    setReady(pl.ok ? pl.ready !== false : true);
    setRows(pl.ok ? pl.rows : []);
    setStaff(st.ok ? st.staff : []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (authed) fetchAll();
  }, [authed, fetchAll]);

  const resetForm = () => {
    setUserId(""); setGrantDays("10"); setGrantDate(today());
    setTakeDate(today()); setTakeDays("1"); setNote(""); setError(null);
  };

  const openForm = (m: "grant" | "take") => {
    resetForm();
    setMode(m);
  };

  const submit = async () => {
    if (!userId) { setError("スタッフを選択してください"); return; }
    setSaving(true);
    setError(null);
    const body =
      mode === "grant"
        ? { action: "grant", user_id: userId, granted_days: Number(grantDays), grant_date: grantDate, note }
        : { action: "take", user_id: userId, taken_date: takeDate, days: Number(takeDays), note };
    const res = await fetch("/api/admin/paid-leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!data.ok) { setError(data.message ?? "保存に失敗しました"); return; }
    setMode("none");
    resetForm();
    fetchAll();
  };

  const remove = async (type: "grant" | "taking", id: string) => {
    if (!confirm("この記録を削除しますか？")) return;
    const res = await fetch(`/api/admin/paid-leave?type=${type}&id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({ ok: false }));
    if (data.ok) fetchAll();
    else alert(data.message ?? "削除に失敗しました");
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
          <p className="text-xs text-green-100">有給管理</p>
        </div>
        <button onClick={handleLogout} title="ログアウト" className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
          <LogOut size={18} />
        </button>
      </header>

      <AdminNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-gray-700 flex items-center gap-2">
            <CalendarHeart size={18} className="text-[#06C755]" /> 有給休暇
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => openForm("grant")} className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] transition-colors">
              <Plus size={16} /> 付与
            </button>
            <button onClick={() => openForm("take")} className="flex items-center gap-1 border border-[#06C755] text-[#06C755] text-sm font-bold px-3 py-2 rounded-lg hover:bg-green-50 transition-colors">
              <Minus size={16} /> 取得
            </button>
          </div>
        </div>

        {!ready && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            有給テーブルの準備中です（マイグレーション反映待ち）。数分後に再読み込みしてください。
          </div>
        )}

        {mode !== "none" && (
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <p className="font-bold text-gray-700 text-sm">{mode === "grant" ? "有給を付与" : "有給の取得を記録"}</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">スタッフ *</span>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#06C755]">
                <option value="">選択してください</option>
                {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
              </select>
            </label>

            {mode === "grant" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">付与日数 *</span>
                  <input value={grantDays} onChange={(e) => setGrantDays(e.target.value.replace(/[^\d.]/g, ""))} placeholder="10" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">付与日</span>
                  <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]" />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">取得日 *</span>
                  <input type="date" value={takeDate} onChange={(e) => setTakeDate(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">日数</span>
                  <select value={takeDays} onChange={(e) => setTakeDays(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#06C755]">
                    <option value="1">1日</option>
                    <option value="0.5">半休（0.5日）</option>
                  </select>
                </label>
              </div>
            )}

            <label className="block">
              <span className="text-xs font-semibold text-gray-500">メモ</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="入社時付与 / 私用 等" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]" />
            </label>

            <div className="flex gap-2 pt-1">
              <button onClick={submit} disabled={saving} className="flex-1 bg-[#06C755] text-white font-bold py-2.5 rounded-lg hover:bg-[#05b34c] disabled:opacity-60 transition-colors">
                {saving ? "保存中..." : mode === "grant" ? "付与する" : "取得を記録"}
              </button>
              <button onClick={() => { setMode("none"); resetForm(); }} className="px-4 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors">
                キャンセル
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <CalendarHeart size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">まだ有給の付与記録がありません</p>
            <p className="text-xs mt-1">「付与」から登録してください</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="text-left font-semibold px-4 py-3">スタッフ</th>
                    <th className="text-right font-semibold px-3 py-3">残</th>
                    <th className="text-right font-semibold px-3 py-3">付与(有効)</th>
                    <th className="text-right font-semibold px-3 py-3">取得</th>
                    <th className="text-left font-semibold px-3 py-3">直近失効</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const open = expanded === r.user_id;
                    return (
                      <Fragment key={r.user_id}>
                        <tr className="border-t border-gray-50 hover:bg-gray-50/60 cursor-pointer" onClick={() => setExpanded(open ? null : r.user_id)}>
                          <td className="px-4 py-3 font-semibold text-gray-800">
                            <span className="flex items-center gap-1.5">
                              {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                              {r.staff_name}
                            </span>
                          </td>
                          <td className={`px-3 py-3 text-right font-bold ${r.remaining <= 0 ? "text-gray-400" : "text-gray-800"}`}>{r.remaining}日</td>
                          <td className="px-3 py-3 text-right text-gray-500">{r.grantedActive}日</td>
                          <td className="px-3 py-3 text-right text-gray-500">{r.takenTotal}日</td>
                          <td className="px-3 py-3 text-left text-gray-400">{r.nextExpiry ?? "-"}</td>
                        </tr>
                        {open && (
                          <tr className="bg-gray-50/50">
                            <td colSpan={5} className="px-4 py-3">
                              <div className="grid sm:grid-cols-2 gap-3">
                                <HistoryBlock title="付与履歴" empty="付与なし">
                                  {r.grants.map((g) => (
                                    <HistoryItem key={g.id} onDelete={() => remove("grant", g.id)}>
                                      <span className="font-mono">{g.grant_date}</span> ／ +{g.granted_days}日
                                      <span className="text-gray-400"> （失効 {g.expires_on}）</span>
                                      {g.note && <span className="text-gray-400"> {g.note}</span>}
                                    </HistoryItem>
                                  ))}
                                </HistoryBlock>
                                <HistoryBlock title="取得履歴" empty="取得なし">
                                  {r.takings.map((t) => (
                                    <HistoryItem key={t.id} onDelete={() => remove("taking", t.id)}>
                                      <span className="font-mono">{t.taken_date}</span> ／ -{t.days}日
                                      {t.note && <span className="text-gray-400"> {t.note}</span>}
                                    </HistoryItem>
                                  ))}
                                </HistoryBlock>
                              </div>
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
        )}

        <p className="text-xs text-gray-400">
          ※ 残（有効）＝ 失効していない付与の合計 − 取得の合計。付与日数・付与日は管理者が入力します（勤続からの自動付与は今後対応）。
          失効の厳密な充当は行わない管理補助です。年5日取得義務など正式な判断は社労士にご確認ください。
        </p>
      </main>
    </div>
  );
}

function HistoryBlock({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs font-bold text-gray-500 mb-2">{title}</p>
      {has ? <div className="space-y-1">{children}</div> : <p className="text-xs text-gray-300">{empty}</p>}
    </div>
  );
}

function HistoryItem({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
      <span>{children}</span>
      <button onClick={onDelete} title="削除" className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
        <Trash2 size={13} />
      </button>
    </div>
  );
}
