"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Settings, LogOut, Save, ArrowLeft, Info } from "lucide-react";
import AdminNav from "@/components/AdminNav";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

type Form = {
  closingDay: number;
  weekStart: number;
  holidayMode: "weekly_fixed" | "shift";
  prescribedOffDows: number[];
  statutoryHolidayDow: number;
  shiftStatutoryRule: "weekly_auto" | "fixed_dow";
  roundUnitMin: number;
  roundMode: "up" | "nearest";
  overtimeRate: number;
  nightRate: number;
  holidayRate: number;
  break6h: number;
  break8h: number;
};

const FALLBACK: Form = {
  closingDay: 31, weekStart: 1, holidayMode: "weekly_fixed", prescribedOffDows: [0, 6],
  statutoryHolidayDow: 0, shiftStatutoryRule: "weekly_auto", roundUnitMin: 1, roundMode: "up",
  overtimeRate: 1.25, nightRate: 1.25, holidayRate: 1.35, break6h: 45, break8h: 60,
};

export default function PayrollSettingsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [companyName, setCompanyName] = useState("ラクラク勤怠");
  const [form, setForm] = useState<Form>(FALLBACK);
  const [source, setSource] = useState<"db" | "default">("default");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.ok) {
          setAuthed(true);
          setCompanyName(data.company?.name ?? "ラクラク勤怠");
        } else router.replace("/admin/login");
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/payroll/settings", { cache: "no-store" });
    if (res.status === 401) { router.replace("/admin/login"); return; }
    const data = await res.json();
    if (data.ok) {
      const s = data.settings;
      setForm({
        closingDay: s.closingDay, weekStart: s.weekStart, holidayMode: s.holidayMode,
        prescribedOffDows: s.prescribedOffDows ?? [0, 6], statutoryHolidayDow: s.statutoryHolidayDow,
        shiftStatutoryRule: s.shiftStatutoryRule, roundUnitMin: s.roundUnitMin, roundMode: s.roundMode,
        overtimeRate: s.overtimeRate, nightRate: s.nightRate, holidayRate: s.holidayRate,
        break6h: s.deemedBreaks?.find((r: { over_min: number }) => r.over_min === 360)?.break_min ?? 45,
        break8h: s.deemedBreaks?.find((r: { over_min: number }) => r.over_min === 480)?.break_min ?? 60,
      });
      setSource(data.source);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null);
    const body = {
      closingDay: form.closingDay, weekStart: form.weekStart, holidayMode: form.holidayMode,
      prescribedOffDows: form.prescribedOffDows, statutoryHolidayDow: form.statutoryHolidayDow,
      shiftStatutoryRule: form.shiftStatutoryRule, roundUnitMin: form.roundUnitMin, roundScope: "month",
      roundMode: form.roundMode, overtimeRate: form.overtimeRate, nightRate: form.nightRate, holidayRate: form.holidayRate,
      deemedBreaks: [{ over_min: 360, break_min: form.break6h }, { over_min: 480, break_min: form.break8h }],
    };
    const res = await fetch("/api/admin/payroll/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { setSource("db"); setMsg({ kind: "ok", text: "保存しました" }); }
    else setMsg({ kind: "err", text: data.message ?? "保存に失敗しました" });
    setSaving(false);
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
          <p className="text-xs text-green-100">給与集計の設定</p>
        </div>
        <button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); router.replace("/admin/login"); }}
          title="ログアウト" className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
          <LogOut size={18} />
        </button>
      </header>

      <AdminNav />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push("/admin/payroll")} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} /> 給与集計に戻る
          </button>
          <span className={`text-xs px-2 py-1 rounded-full ${source === "db" ? "bg-green-50 text-[#06C755]" : "bg-gray-100 text-gray-500"}`}>
            {source === "db" ? "保存済みの設定" : "初期設定（未保存）"}
          </span>
        </div>

        {source === "default" && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 flex items-start gap-2">
            <Info size={16} className="flex-shrink-0 mt-0.5" />
            <span>まだ保存された設定がありません。下の初期値が使われています。保存には給与テーブル（PHASE_B_MIGRATION.sql）の適用が必要です。</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <Card title="締め・週">
              <Field label="締め日">
                <input type="number" min={1} max={31} value={form.closingDay}
                  onChange={(e) => set("closingDay", Number(e.target.value))} className={inputCls} />
                <Hint>末日は 31。20日締めなら 20。</Hint>
              </Field>
              <Field label="週の起算曜日">
                <Select value={form.weekStart} onChange={(v) => set("weekStart", v)} options={DOW.map((d, i) => ({ v: i, l: `${d}曜` }))} />
              </Field>
            </Card>

            <Card title="休日">
              <Field label="休日モード">
                <Select value={form.holidayMode} onChange={(v) => set("holidayMode", v as Form["holidayMode"])}
                  options={[{ v: "weekly_fixed", l: "曜日固定（土日休みなど）" }, { v: "shift", l: "シフト休み（サービス業向け）" }]} />
              </Field>
              {form.holidayMode === "weekly_fixed" ? (
                <Field label="所定休日の曜日">
                  <div className="flex flex-wrap gap-1.5">
                    {DOW.map((d, i) => {
                      const on = form.prescribedOffDows.includes(i);
                      return (
                        <button key={i} type="button"
                          onClick={() => set("prescribedOffDows", on ? form.prescribedOffDows.filter((x) => x !== i) : [...form.prescribedOffDows, i])}
                          className={`w-9 h-9 rounded-lg text-sm font-semibold ${on ? "bg-[#06C755] text-white" : "bg-gray-100 text-gray-500"}`}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              ) : (
                <Field label="法定休日の判定">
                  <Select value={form.shiftStatutoryRule} onChange={(v) => set("shiftStatutoryRule", v as Form["shiftStatutoryRule"])}
                    options={[{ v: "weekly_auto", l: "週次自動（休みが無い週の7日目を法定休日）" }, { v: "fixed_dow", l: "曜日を固定指定" }]} />
                </Field>
              )}
              {(form.holidayMode === "weekly_fixed" || form.shiftStatutoryRule === "fixed_dow") && (
                <Field label="法定休日の曜日">
                  <Select value={form.statutoryHolidayDow} onChange={(v) => set("statutoryHolidayDow", v)} options={DOW.map((d, i) => ({ v: i, l: `${d}曜` }))} />
                </Field>
              )}
            </Card>

            <Card title="割増・丸め・休憩">
              <Field label="丸め単位（分）">
                <Select value={form.roundUnitMin} onChange={(v) => set("roundUnitMin", v)}
                  options={[1, 5, 15, 60].map((u) => ({ v: u, l: u === 1 ? "1分（丸めなし）" : `${u}分` }))} />
                <Hint>月合計に対して適用します。</Hint>
              </Field>
              <Field label="丸め方向">
                <Select value={form.roundMode} onChange={(v) => set("roundMode", v as Form["roundMode"])}
                  options={[{ v: "up", l: "切り上げ" }, { v: "nearest", l: "四捨五入" }]} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="残業割増"><input type="number" step={0.05} value={form.overtimeRate} onChange={(e) => set("overtimeRate", Number(e.target.value))} className={inputCls} /></Field>
                <Field label="深夜割増"><input type="number" step={0.05} value={form.nightRate} onChange={(e) => set("nightRate", Number(e.target.value))} className={inputCls} /></Field>
                <Field label="休日割増"><input type="number" step={0.05} value={form.holidayRate} onChange={(e) => set("holidayRate", Number(e.target.value))} className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="みなし休憩 6h超（分）"><input type="number" min={0} value={form.break6h} onChange={(e) => set("break6h", Number(e.target.value))} className={inputCls} /></Field>
                <Field label="みなし休憩 8h超（分）"><input type="number" min={0} value={form.break8h} onChange={(e) => set("break8h", Number(e.target.value))} className={inputCls} /></Field>
              </div>
            </Card>

            {msg && (
              <div className={`rounded-xl px-4 py-3 text-sm ${msg.kind === "ok" ? "bg-green-50 text-[#06C755] border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {msg.text}
              </div>
            )}

            <button onClick={save} disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-[#06C755] text-white font-bold py-3 rounded-xl hover:bg-[#05b34c] disabled:opacity-50 transition-colors">
              <Save size={18} /> {saving ? "保存中..." : "設定を保存"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#06C755]";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4 space-y-3">
      <h3 className="font-bold text-sm text-gray-700">{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-gray-400 mt-1">{children}</p>;
}
function Select<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <select value={String(value)} onChange={(e) => {
      const raw = e.target.value;
      const picked = options.find((o) => String(o.v) === raw);
      if (picked) onChange(picked.v);
    }} className={inputCls}>
      {options.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.l}</option>)}
    </select>
  );
}
