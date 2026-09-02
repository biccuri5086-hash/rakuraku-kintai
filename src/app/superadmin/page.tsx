"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Building2, LogOut, Plus, Users, RefreshCw, Settings, Copy, Check, LockKeyhole, Shield, Monitor } from "lucide-react";

type Company = {
  id: string;
  name: string;
  invite_code: string;
  plan: "standard" | "pro" | "enterprise";
  status: "active" | "trial" | "suspended" | "cancelled";
  trial_ends_at: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  staff_count: number;
  created_at: string;
};

const PLAN_LABELS: Record<Company["plan"], { label: string; color: string }> = {
  standard:   { label: "スタンダード", color: "bg-slate-200 text-slate-700" },
  pro:        { label: "プロ",         color: "bg-blue-100 text-blue-700" },
  enterprise: { label: "エンタープライズ", color: "bg-amber-100 text-amber-700" },
};

const STATUS_LABELS: Record<Company["status"], { label: string; color: string }> = {
  active:    { label: "稼働中",   color: "bg-green-100 text-green-700" },
  trial:     { label: "試用中",   color: "bg-blue-100 text-blue-700" },
  suspended: { label: "停止中",   color: "bg-orange-100 text-orange-700" },
  cancelled: { label: "解約済み", color: "bg-red-100 text-red-700" },
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/superadmin/me", { cache: "no-store" })
      .then((r) => (r.ok ? setAuthed(true) : router.replace("/superadmin/login")))
      .catch(() => router.replace("/superadmin/login"));
  }, [router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/superadmin/companies", { cache: "no-store" });
    if (res.status === 401) { router.replace("/superadmin/login"); return; }
    const data = await res.json();
    setCompanies(data.ok ? data.companies : []);
    setLoading(false);
  }, [router]);

  useEffect(() => { if (authed) fetchData(); }, [authed, fetchData]);

  const handleLogout = async () => {
    await fetch("/api/superadmin/logout", { method: "POST" });
    router.replace("/superadmin/login");
  };

  const copyInvite = async (code: string) => {
    const url = `${window.location.origin}/?invite=${code}`;
    await navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (!authed) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalStaff = companies.reduce((s, c) => s + c.staff_count, 0);
  const activeCount = companies.filter((c) => c.status === "active").length;
  const trialCount = companies.filter((c) => c.status === "trial").length;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-slate-900 to-slate-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">ラクラク勤怠</h1>
          <p className="text-xs text-amber-400 font-bold">プラットフォーム管理</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push("/superadmin/2fa-setup")} className="p-2 rounded-full bg-white/10 hover:bg-white/20" title="2段階認証">
            <Shield size={18} />
          </button>
          <button onClick={() => router.push("/superadmin/password")} className="p-2 rounded-full bg-white/10 hover:bg-white/20" title="パスワード変更">
            <LockKeyhole size={18} />
          </button>
          <button onClick={() => router.push("/superadmin/sessions")} className="p-2 rounded-full bg-white/10 hover:bg-white/20" title="ログイン中の端末">
            <Monitor size={18} />
          </button>
          <button onClick={fetchData} className="p-2 rounded-full bg-white/10 hover:bg-white/20" title="更新">
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={handleLogout} className="p-2 rounded-full bg-white/10 hover:bg-white/20" title="ログアウト">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl shadow p-4 text-center">
            <Building2 size={20} className="text-amber-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-800">{companies.length}</p>
            <p className="text-xs text-slate-400">テナント総数</p>
          </div>
          <div className="bg-white rounded-2xl shadow p-4 text-center">
            <Users size={20} className="text-blue-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-800">{totalStaff}</p>
            <p className="text-xs text-slate-400">全スタッフ数</p>
          </div>
          <div className="bg-white rounded-2xl shadow p-4 text-center">
            <Settings size={20} className="text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-800">{activeCount} / {trialCount}</p>
            <p className="text-xs text-slate-400">稼働中 / 試用中</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-700">テナント（派遣会社）一覧</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-3 py-1.5 rounded-lg"
            >
              <Plus size={16} /> 新規追加
            </button>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center">
              <div className="w-6 h-6 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : companies.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">テナントがまだ登録されていません</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">会社名</th>
                  <th className="text-left px-2 py-2">プラン</th>
                  <th className="text-left px-2 py-2">状態</th>
                  <th className="text-center px-2 py-2">スタッフ</th>
                  <th className="text-left px-2 py-2">招待リンク</th>
                  <th className="text-center px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{c.name}</p>
                      {c.contact_name && <p className="text-xs text-slate-400">{c.contact_name}</p>}
                    </td>
                    <td className="px-2 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${PLAN_LABELS[c.plan].color}`}>
                        {PLAN_LABELS[c.plan].label}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_LABELS[c.status].color}`}>
                        {STATUS_LABELS[c.status].label}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center font-bold text-slate-700">{c.staff_count}</td>
                    <td className="px-2 py-3">
                      <button
                        onClick={() => copyInvite(c.invite_code)}
                        className="flex items-center gap-1 text-xs font-mono bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded"
                      >
                        {copiedCode === c.invite_code ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                        {c.invite_code.slice(0, 8)}...
                      </button>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <button
                        onClick={() => router.push(`/superadmin/companies/${c.id}`)}
                        className="text-amber-600 hover:underline text-xs font-bold"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateCompanyModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchData(); }} />
      )}
    </div>
  );
}

function CreateCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Company["plan"]>("standard");
  const [status, setStatus] = useState<Company["status"]>("trial");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/superadmin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, plan, status,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.ok) onCreated();
    else setError(data.message ?? "登録に失敗しました");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-slate-800 mb-4">新規テナント追加</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">会社名 *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">プラン</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value as Company["plan"])}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="standard">スタンダード</option>
                <option value="pro">プロ</option>
                <option value="enterprise">エンタープライズ</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">状態</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as Company["status"])}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="trial">試用中（30日無料）</option>
                <option value="active">稼働中（有料）</option>
                <option value="suspended">停止中</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">担当者名</label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">担当メール</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">担当電話</label>
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-700 font-bold py-2 rounded-lg">
              キャンセル
            </button>
            <button type="submit" disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 rounded-lg disabled:opacity-50">
              {loading ? "作成中..." : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
