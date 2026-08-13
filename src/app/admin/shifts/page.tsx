"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, LogOut, Trash2 } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Assignment = {
  id: string;
  type: "spot" | "ongoing";
  client_name: string;
  staff_name: string;
};
type Shift = {
  id: string;
  assignment_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  status: string;
};

const EMPTY = { assignment_id: "", work_date: "", start_time: "", end_time: "", break_minutes: "60" };

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  planned: { label: "予定", cls: "bg-gray-100 text-gray-600" },
  confirmed: { label: "確定", cls: "bg-blue-100 text-blue-700" },
  done: { label: "完了", cls: "bg-green-100 text-green-700" },
  absent: { label: "欠勤", cls: "bg-red-100 text-red-700" },
};

export default function ShiftsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const [sRes, aRes] = await Promise.all([
      fetch("/api/admin/shifts", { cache: "no-store" }),
      fetch("/api/admin/assignments", { cache: "no-store" }),
    ]);
    if (sRes.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const [s, a] = await Promise.all([sRes.json(), aRes.json()]);
    setShifts(s.ok ? s.shifts : []);
    setAssignments(a.ok ? a.assignments : []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (authed) fetchAll();
  }, [authed, fetchAll]);

  const assignMap = new Map(assignments.map((a) => [a.id, a]));
  const labelOf = (id: string) => {
    const a = assignMap.get(id);
    return a ? `${a.staff_name} → ${a.client_name}` : "（削除された契約）";
  };

  const handleSave = async () => {
    if (!form.assignment_id || !form.work_date) {
      setError("契約と勤務日は必須です");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!data.ok) {
      setError(data.message ?? "登録に失敗しました");
      return;
    }
    setForm({ ...EMPTY });
    setShowForm(false);
    fetchAll();
  };

  const handleDelete = async (id: string, date: string) => {
    if (!confirm(`${date} のシフトを削除しますか？`)) return;
    const res = await fetch(`/api/admin/shifts?id=${id}`, { method: "DELETE" });
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

  const noAssign = assignments.length === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p className="text-xs text-green-100">シフト管理</p>
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
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-700 flex items-center gap-2">
            <CalendarClock size={18} className="text-[#06C755]" /> シフト一覧
          </h2>
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setError(null);
            }}
            disabled={noAssign}
            className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] disabled:opacity-50 transition-colors"
          >
            <Plus size={16} /> シフトを追加
          </button>
        </div>

        {noAssign && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            シフトを作るには、先に<span className="font-bold">契約</span>の登録が必要です。
          </div>
        )}

        {showForm && !noAssign && (
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">契約 *</span>
              <select
                value={form.assignment_id}
                onChange={(e) => setForm({ ...form, assignment_id: e.target.value })}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#06C755]"
              >
                <option value="">選択してください</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.staff_name} → {a.client_name}（{a.type === "ongoing" ? "中長期" : "単発"}）
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-gray-500">勤務日 *</span>
                <input
                  type="date"
                  value={form.work_date}
                  onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-500">休憩（分）</span>
                <input
                  value={form.break_minutes}
                  onChange={(e) => setForm({ ...form, break_minutes: e.target.value.replace(/\D/g, "") })}
                  placeholder="60"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-gray-500">開始時刻</span>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-500">終了時刻</span>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
                />
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-[#06C755] text-white font-bold py-2.5 rounded-lg hover:bg-[#05b34c] disabled:opacity-60 transition-colors"
              >
                {saving ? "登録中..." : "シフトを登録する"}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setForm({ ...EMPTY });
                  setError(null);
                }}
                className="px-4 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shifts.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <CalendarClock size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">まだシフトが登録されていません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shifts.map((sh) => {
              const st = STATUS_LABEL[sh.status] ?? STATUS_LABEL.planned;
              return (
                <div key={sh.id} className="bg-white rounded-2xl shadow p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-800">{sh.work_date}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      <button
                        onClick={() => handleDelete(sh.id, sh.work_date)}
                        title="削除"
                        className="text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{labelOf(sh.assignment_id)}</p>
                  <div className="mt-2 pt-2 border-t border-gray-50 text-xs text-gray-500 flex flex-wrap gap-x-4">
                    <span className="font-mono">
                      {sh.start_time ?? "--:--"} 〜 {sh.end_time ?? "--:--"}
                    </span>
                    <span>休憩 {sh.break_minutes}分</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
