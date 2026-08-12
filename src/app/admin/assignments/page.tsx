"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, LogOut, ArrowRight } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type StaffOption = { user_id: string; name: string };
type ClientOption = { id: string; name: string };
type Assignment = {
  id: string;
  user_id: string;
  client_id: string;
  type: "spot" | "ongoing";
  start_date: string;
  end_date: string | null;
  job_content: string | null;
  hourly_rate: number | null;
  status: string;
  client_name: string;
  staff_name: string;
};

const EMPTY = {
  user_id: "",
  client_id: "",
  type: "spot" as "spot" | "ongoing",
  start_date: "",
  end_date: "",
  job_content: "",
  hourly_rate: "",
};

export default function AssignmentsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
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
    const [aRes, sRes, cRes] = await Promise.all([
      fetch("/api/admin/assignments", { cache: "no-store" }),
      fetch("/api/admin/staff", { cache: "no-store" }),
      fetch("/api/admin/clients", { cache: "no-store" }),
    ]);
    if (aRes.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const [a, sData, c] = await Promise.all([aRes.json(), sRes.json(), cRes.json()]);
    setAssignments(a.ok ? a.assignments : []);
    setStaff(sData.ok ? sData.staff : []);
    setClients(c.ok ? c.clients : []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (authed) fetchAll();
  }, [authed, fetchAll]);

  const handleSave = async () => {
    if (!form.user_id || !form.client_id || !form.start_date) {
      setError("スタッフ・派遣先・開始日は必須です");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/assignments", {
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

  const noMaster = staff.length === 0 || clients.length === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <p className="text-xs text-green-100">契約（アサイン）管理</p>
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
            <FileText size={18} className="text-[#06C755]" /> 契約一覧
          </h2>
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setError(null);
            }}
            disabled={noMaster}
            className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] disabled:opacity-50 transition-colors"
          >
            <Plus size={16} /> 契約を追加
          </button>
        </div>

        {noMaster && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            契約を作るには、先に
            {staff.length === 0 && <span className="font-bold">スタッフ登録</span>}
            {staff.length === 0 && clients.length === 0 && "と"}
            {clients.length === 0 && <span className="font-bold">派遣先登録</span>}
            が必要です。
          </div>
        )}

        {showForm && !noMaster && (
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="スタッフ *"
                value={form.user_id}
                onChange={(v) => setForm({ ...form, user_id: v })}
                options={[{ value: "", label: "選択してください" }, ...staff.map((s) => ({ value: s.user_id, label: s.name }))]}
              />
              <Select
                label="派遣先 *"
                value={form.client_id}
                onChange={(v) => setForm({ ...form, client_id: v })}
                options={[{ value: "", label: "選択してください" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
            <Select
              label="契約タイプ *"
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v as "spot" | "ongoing" })}
              options={[
                { value: "spot", label: "単発（1日・スポット）" },
                { value: "ongoing", label: "中長期（期間・シフトあり）" },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <DateField label="開始日 *" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} />
              <DateField label="終了日（任意）" value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="業務内容" value={form.job_content} onChange={(v) => setForm({ ...form, job_content: v })} placeholder="ピッキング作業 等" />
              <Field label="時給（円）" value={form.hourly_rate} onChange={(v) => setForm({ ...form, hourly_rate: v.replace(/\D/g, "") })} placeholder="1200" />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-[#06C755] text-white font-bold py-2.5 rounded-lg hover:bg-[#05b34c] disabled:opacity-60 transition-colors"
              >
                {saving ? "登録中..." : "契約を登録する"}
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
        ) : assignments.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <FileText size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">まだ契約が登録されていません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map((a) => (
              <div key={a.id} className="bg-white rounded-2xl shadow p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-800">{a.staff_name}</span>
                  <ArrowRight size={14} className="text-gray-300" />
                  <span className="font-bold text-gray-800">{a.client_name}</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      a.type === "ongoing" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {a.type === "ongoing" ? "中長期" : "単発"}
                  </span>
                </div>
                <div className="mt-2 pt-2 border-t border-gray-50 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {a.start_date}
                    {a.end_date ? ` 〜 ${a.end_date}` : " 〜"}
                  </span>
                  {a.job_content && <span>💼 {a.job_content}</span>}
                  {a.hourly_rate != null && <span>時給 {a.hourly_rate.toLocaleString()}円</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
      />
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#06C755]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
