"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Trash2, UserPlus, Building2, Copy, Check, KeyRound, AlertTriangle } from "lucide-react";

type Company = {
  id: string;
  name: string;
  invite_code: string;
  plan: "standard" | "pro" | "enterprise";
  status: "active" | "trial" | "suspended" | "cancelled";
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  trial_ends_at: string | null;
  staff_count: number;
};

type Settings = {
  feature_condition: boolean;
  feature_gps: boolean;
  feature_alert: boolean;
  feature_monthly_report: boolean;
  feature_multi_site: boolean;
  feature_ai_risk_score: boolean;
  comment_required: boolean;
  max_staff_count: number | null;
};

type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

const FEATURE_LABELS: Record<keyof Omit<Settings, "max_staff_count">, string> = {
  feature_condition: "コンディション報告",
  feature_gps: "GPS打刻",
  feature_alert: "アラート通知",
  feature_monthly_report: "月次レポート",
  feature_multi_site: "複数現場管理",
  feature_ai_risk_score: "AI離職予測",
  comment_required: "打刻時コメント必須",
};

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/superadmin/companies/${id}`, { cache: "no-store" });
    if (res.status === 401) { router.replace("/superadmin/login"); return; }
    const data = await res.json();
    if (data.ok) {
      setCompany(data.company);
      setSettings(data.settings);
      setAdmins(data.admins);
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateCompany = async (patch: Partial<Company>) => {
    setSaving(true);
    const res = await fetch(`/api/superadmin/companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) await fetchData();
    setSaving(false);
  };

  const toggleFeature = async (key: keyof Settings, value: boolean) => {
    setSaving(true);
    await fetch(`/api/superadmin/companies/${id}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    await fetchData();
    setSaving(false);
  };

  const deleteCompany = async () => {
    if (!confirm(`「${company?.name}」を完全に削除します。\n所属スタッフの全データも削除されます。\n本当によろしいですか？`)) return;
    const res = await fetch(`/api/superadmin/companies/${id}`, { method: "DELETE" });
    if (res.ok) router.replace("/superadmin");
  };

  const removeAdmin = async (adminId: string, name: string) => {
    if (!confirm(`管理者「${name}」を削除しますか？`)) return;
    await fetch(`/api/superadmin/companies/${id}/admins?admin_id=${adminId}`, { method: "DELETE" });
    await fetchData();
  };

  const resetAdminPassword = async (admin: AdminUser) => {
    if (!confirm(`「${admin.full_name}」のパスワードを再発行します。\n\n今までのパスワードはこの操作で使えなくなります。\n新しいパスワードは一度しか表示されません。\n\n実行しますか？`)) return;
    setResettingId(admin.id);
    const res = await fetch(`/api/superadmin/companies/${id}/admins`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_id: admin.id }),
    });
    const data = await res.json();
    setResettingId(null);
    if (data.ok) {
      setIssued({ name: admin.full_name, email: admin.email, password: data.password });
      await fetchData();
    } else {
      alert(data.message ?? "再発行に失敗しました");
    }
  };

  const copyInvite = async () => {
    if (!company) return;
    const url = `${window.location.origin}/?invite=${company.invite_code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || !company || !settings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-slate-900 to-slate-700 text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button onClick={() => router.push("/superadmin")} className="p-1.5 rounded hover:bg-white/10">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold">{company.name}</h1>
          <p className="text-xs text-amber-400">テナント詳細</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white rounded-2xl shadow p-5">
          <h2 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <Building2 size={18} /> 基本情報
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="会社名" value={company.name} onChange={(v) => updateCompany({ name: v })} />
            <Selector label="プラン" value={company.plan} options={[
              ["standard", "スタンダード"], ["pro", "プロ"], ["enterprise", "エンタープライズ"]
            ]} onChange={(v) => updateCompany({ plan: v as Company["plan"] })} />
            <Selector label="状態" value={company.status} options={[
              ["active", "稼働中"], ["trial", "試用中"], ["suspended", "停止中"], ["cancelled", "解約済み"]
            ]} onChange={(v) => updateCompany({ status: v as Company["status"] })} />
            <Field label="担当者" value={company.contact_name ?? ""} onChange={(v) => updateCompany({ contact_name: v })} />
            <Field label="担当メール" value={company.contact_email ?? ""} onChange={(v) => updateCompany({ contact_email: v })} />
            <Field label="担当電話" value={company.contact_phone ?? ""} onChange={(v) => updateCompany({ contact_phone: v })} />
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-1">スタッフ登録用 招待リンク</p>
            <div className="flex gap-2">
              <code className="flex-1 bg-slate-50 text-slate-700 text-xs px-3 py-2 rounded-lg break-all">
                {typeof window !== "undefined" ? `${window.location.origin}/?invite=${company.invite_code}` : `?invite=${company.invite_code}`}
              </code>
              <button onClick={copyInvite} className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                {copied ? <><Check size={14} /> コピー済</> : <><Copy size={14} /> コピー</>}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">このURLからスタッフが登録すると、自動的にこの会社に紐付きます。</p>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow p-5">
          <h2 className="font-bold text-slate-700 mb-3">機能フラグ</h2>
          <div className="space-y-2">
            {Object.entries(FEATURE_LABELS).map(([k, label]) => {
              const key = k as keyof Settings;
              const value = settings[key] as boolean;
              return (
                <label key={k} className="flex items-center justify-between py-2 px-3 hover:bg-slate-50 rounded-lg cursor-pointer">
                  <span className="text-sm text-slate-700">{label}</span>
                  <input
                    type="checkbox"
                    checked={value}
                    disabled={saving}
                    onChange={(e) => toggleFeature(key, e.target.checked)}
                    className="w-5 h-5 accent-amber-500"
                  />
                </label>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-slate-700">テナント管理者</h2>
            <button onClick={() => setShowAddAdmin(true)}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
              <UserPlus size={14} /> 追加
            </button>
          </div>
          {admins.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">管理者が登録されていません</p>
          ) : (
            <div className="space-y-2">
              {admins.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{a.full_name}</p>
                    <p className="text-xs text-slate-500">{a.email}</p>
                    {a.last_login_at && <p className="text-[10px] text-slate-400">最終ログイン：{new Date(a.last_login_at).toLocaleString("ja-JP")}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => resetAdminPassword(a)}
                      disabled={resettingId === a.id}
                      title="パスワードを再発行"
                      className="flex items-center gap-1 text-amber-600 hover:text-amber-800 text-xs font-bold border border-amber-300 rounded-lg px-2 py-1.5 disabled:opacity-50">
                      <KeyRound size={14} /> {resettingId === a.id ? "発行中..." : "パスワード再発行"}
                    </button>
                    <button onClick={() => removeAdmin(a.id, a.full_name)}
                      title="この管理者を削除"
                      className="text-red-500 hover:text-red-700 p-1.5">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow p-5 border-2 border-red-100">
          <h2 className="font-bold text-red-600 mb-2">危険操作</h2>
          <p className="text-xs text-slate-500 mb-3">
            このテナントを削除すると、所属スタッフ {company.staff_count} 名のデータがすべて削除されます。
          </p>
          <button onClick={deleteCompany}
            className="flex items-center gap-1 border border-red-500 text-red-500 hover:bg-red-50 text-sm font-bold px-3 py-1.5 rounded-lg">
            <Trash2 size={14} /> このテナントを削除
          </button>
        </section>
      </main>

      {showAddAdmin && (
        <AddAdminModal companyId={id} onClose={() => setShowAddAdmin(false)} onAdded={() => { setShowAddAdmin(false); fetchData(); }} />
      )}

      {issued && <IssuedPasswordModal issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

// 再発行したパスワードの表示。平文はサーバから一度しか返らないため、
// 閉じる前に控えてもらう必要がある。閉じたら二度と表示できない。
function IssuedPasswordModal({
  issued, onClose,
}: { issued: { name: string; email: string; password: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(issued.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-1">新しいパスワードを発行しました</h2>
        <p className="text-xs text-slate-500 mb-4">{issued.name}（{issued.email}）</p>

        <div className="bg-slate-900 rounded-xl p-4 mb-3">
          <p className="text-[10px] text-slate-400 mb-1.5">新しいパスワード</p>
          <p className="text-lg font-mono text-white break-all select-all">{issued.password}</p>
        </div>

        <button onClick={copy}
          className="w-full flex items-center justify-center gap-1.5 border-2 border-slate-200 hover:border-slate-400 text-slate-700 font-bold py-2.5 rounded-lg mb-4">
          {copied ? <><Check size={16} className="text-green-600" /> コピーしました</> : <><Copy size={16} /> パスワードをコピー</>}
        </button>

        <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 space-y-1">
            <p className="font-bold">この画面を閉じると二度と表示できません。</p>
            <p>先に控えてから閉じてください。控え忘れたときは、もう一度再発行すれば新しいものを発行できます。</p>
            <p>ご本人にはログイン後、管理画面のパスワード変更からご自身のパスワードへ変更するようお伝えください。</p>
            <p>直前に5回以上ログインに失敗している場合、最大15分ほどログインできないことがあります。時間をおいてお試しください。</p>
          </div>
        </div>

        <button onClick={onClose}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-lg">
          控えたので閉じる
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <div className="flex gap-1">
        <input value={local} onChange={(e) => setLocal(e.target.value)}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        {local !== value && (
          <button onClick={() => onChange(local)} className="bg-amber-500 text-white px-2 rounded-lg">
            <Save size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Selector({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function AddAdminModal({ companyId, onClose, onAdded }: { companyId: string; onClose: () => void; onAdded: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/superadmin/companies/${companyId}/admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.ok) onAdded();
    else setError(data.message ?? "追加に失敗しました");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">テナント管理者を追加</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">氏名 *</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">メール *</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">初期パスワード（10文字以上） *</label>
            <input type="text" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <p className="text-[10px] text-slate-400 mt-1">このパスワードを管理者に伝えてください。初回ログイン後の変更を推奨します。</p>
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-700 font-bold py-2 rounded-lg">
              キャンセル
            </button>
            <button type="submit" disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 rounded-lg disabled:opacity-50">
              {loading ? "追加中..." : "追加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
