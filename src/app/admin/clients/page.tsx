"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, MapPin, Phone, LogOut, Trash2, Pencil } from "lucide-react";
import AdminNav from "@/components/AdminNav";

type Client = {
  id: string;
  name: string;
  workplace_name: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  teishokubi: string | null;
  created_at: string;
};

const EMPTY = { name: "", workplace_name: "", address: "", contact_name: "", contact_phone: "" };

export default function ClientsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const fetchClients = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/clients", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setClients(data.ok ? data.clients : []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (authed) fetchClients();
  }, [authed, fetchClients]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("派遣先名は必須です");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/clients", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!data.ok) {
      setError(data.message ?? "保存に失敗しました");
      return;
    }
    setForm({ ...EMPTY });
    setShowForm(false);
    setEditingId(null);
    fetchClients();
  };

  const startEdit = (c: Client) => {
    setForm({
      name: c.name,
      workplace_name: c.workplace_name ?? "",
      address: c.address ?? "",
      contact_name: c.contact_name ?? "",
      contact_phone: c.contact_phone ?? "",
    });
    setEditingId(c.id);
    setShowForm(true);
    setError(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？\n※この派遣先の契約・シフトも一緒に削除されます。`)) return;
    const res = await fetch(`/api/admin/clients?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({ ok: false }));
    if (data.ok) fetchClients();
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
          <p className="text-xs text-green-100">派遣先管理</p>
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
            <Building2 size={18} className="text-[#06C755]" /> 派遣先一覧
          </h2>
          <button
            onClick={() => {
              setEditingId(null);
              setForm({ ...EMPTY });
              setShowForm((v) => !v);
              setError(null);
            }}
            className="flex items-center gap-1 bg-[#06C755] text-white text-sm font-bold px-3 py-2 rounded-lg hover:bg-[#05b34c] transition-colors"
          >
            <Plus size={16} /> 派遣先を追加
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Field label="派遣先名 *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="株式会社◯◯" />
            <Field label="就業場所名" value={form.workplace_name} onChange={(v) => setForm({ ...form, workplace_name: v })} placeholder="◯◯工場 / ◯◯店" />
            <Field label="住所" value={form.address} onChange={(v) => setForm({ ...form, address: v })} placeholder="東京都..." />
            <div className="grid grid-cols-2 gap-3">
              <Field label="担当者名" value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} placeholder="山田" />
              <Field label="担当者電話" value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} placeholder="090-..." />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-[#06C755] text-white font-bold py-2.5 rounded-lg hover:bg-[#05b34c] disabled:opacity-60 transition-colors"
              >
                {saving ? "保存中..." : editingId ? "更新する" : "登録する"}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setForm({ ...EMPTY });
                  setEditingId(null);
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
        ) : clients.length === 0 ? (
          <div className="bg-white rounded-2xl shadow text-center py-12 text-gray-400">
            <Building2 size={28} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">まだ派遣先が登録されていません</p>
            <p className="text-xs mt-1">「派遣先を追加」から登録してください</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl shadow p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-gray-800">{c.name}</p>
                    {c.workplace_name && <p className="text-sm text-gray-500 mt-0.5">{c.workplace_name}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.teishokubi && (
                      <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                        抵触日 {c.teishokubi}
                      </span>
                    )}
                    <button
                      onClick={() => startEdit(c)}
                      title="編集"
                      className="text-gray-300 hover:text-[#06C755] transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id, c.name)}
                      title="削除"
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {(c.address || c.contact_name || c.contact_phone) && (
                  <div className="mt-2 pt-2 border-t border-gray-50 space-y-1 text-xs text-gray-500">
                    {c.address && (
                      <p className="flex items-center gap-1">
                        <MapPin size={12} /> {c.address}
                      </p>
                    )}
                    {(c.contact_name || c.contact_phone) && (
                      <p className="flex items-center gap-1">
                        <Phone size={12} /> {c.contact_name ?? ""} {c.contact_phone ? `／ ${c.contact_phone}` : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
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
