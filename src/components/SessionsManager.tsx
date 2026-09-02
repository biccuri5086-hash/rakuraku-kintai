"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Monitor, Smartphone, LogOut, ShieldCheck } from "lucide-react";

type SessionSummary = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  userAgent: string | null;
  ip: string | null;
};

type Accent = "green" | "slate";

const ACCENT: Record<Accent, { header: string; btn: string; badge: string; ring: string }> = {
  green: {
    header: "bg-[#06C755]",
    btn: "bg-[#06C755] hover:bg-[#05b34c]",
    badge: "bg-green-100 text-green-800",
    ring: "border-[#06C755]",
  },
  slate: {
    header: "bg-gradient-to-r from-slate-900 to-slate-700",
    btn: "bg-slate-800 hover:bg-slate-900",
    badge: "bg-slate-200 text-slate-800",
    ring: "border-slate-700",
  },
};

// user-agent から、ざっくりした端末名を作る（表示用の目安）。
export function describeUserAgent(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "不明な端末", mobile: false };
  const mobile = /iPhone|Android|iPad|Mobile/i.test(ua);
  let os = "不明なOS";
  if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  return { label: browser ? `${os}・${browser}` : os, mobile };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  return `${day}日前`;
}

export default function SessionsManager({
  apiPath, loginPath, backPath, accent,
}: { apiPath: string; loginPath: string; backPath: string; accent: Accent }) {
  const router = useRouter();
  const c = ACCENT[accent];
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath, { cache: "no-store" });
      if (res.status === 401) { router.replace(loginPath); return; }
      const data = await res.json();
      if (!data.ok) { setError(data.message ?? "取得に失敗しました"); return; }
      setError(null);
      setSessions(data.sessions ?? []);
      setCurrent(data.current ?? null);
    } catch {
      setError("通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [apiPath, loginPath, router]);

  // 初回ロードはプロジェクト既存の .then パターンに合わせる（load は各操作後の再取得で使用）。
  useEffect(() => {
    let alive = true;
    fetch(apiPath, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) { router.replace(loginPath); return; }
        const data = await res.json().catch(() => ({ ok: false }));
        if (!alive) return;
        if (data.ok) { setSessions(data.sessions ?? []); setCurrent(data.current ?? null); setError(null); }
        else setError(data.message ?? "取得に失敗しました");
      })
      .catch(() => { if (alive) setError("通信に失敗しました"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apiPath, loginPath, router]);

  const revokeOne = async (id: string) => {
    if (id === current) {
      if (!confirm("この端末（今使っている端末）からログアウトします。よろしいですか？")) return;
    } else if (!confirm("この端末をログアウトさせます。よろしいですか？")) return;
    setBusyId(id);
    const res = await fetch(`${apiPath}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({ ok: false }));
    setBusyId(null);
    if (data.ok && data.wasCurrent) { router.replace(loginPath); return; }
    if (!data.ok) { setError(data.message ?? "失敗しました"); return; }
    load();
  };

  const revokeOthers = async () => {
    if (!confirm("現在の端末以外のすべてのログインを解除します。よろしいですか？")) return;
    setBusyId("others");
    const res = await fetch(`${apiPath}?others=1`, { method: "DELETE" });
    const data = await res.json().catch(() => ({ ok: false }));
    setBusyId(null);
    if (!data.ok) { setError(data.message ?? "失敗しました"); return; }
    load();
  };

  const others = sessions.filter((s) => s.id !== current);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className={`${c.header} text-white px-4 py-3 flex items-center gap-3 shadow-md`}>
        <button onClick={() => router.push(backPath)} className="p-1 rounded-full hover:bg-white/20 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Monitor size={18} /> ログイン中の端末
        </h1>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          あなたのアカウントで今ログインしている端末の一覧です。見覚えのない端末があれば
          「ログアウト」で解除してください。パスワードや2段階認証を変更すると、この端末以外は自動で解除されます。
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-10">
            <div className={`w-7 h-7 border-4 ${c.ring} border-t-transparent rounded-full animate-spin`} />
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {sessions.map((s) => {
                const d = describeUserAgent(s.userAgent);
                const isCurrent = s.id === current;
                return (
                  <li key={s.id} className="bg-white rounded-2xl shadow p-4 flex items-start gap-3">
                    <div className="mt-0.5 text-gray-400">
                      {d.mobile ? <Smartphone size={20} /> : <Monitor size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm flex items-center gap-2">
                        {d.label}
                        {isCurrent && (
                          <span className={`${c.badge} text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1`}>
                            <ShieldCheck size={11} /> この端末
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        最終利用 {relativeTime(s.lastUsedAt)}
                        {s.ip ? ` ・ ${s.ip}` : ""}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5 break-all">
                        {s.userAgent ?? "不明"}
                      </p>
                    </div>
                    <button
                      onClick={() => revokeOne(s.id)}
                      disabled={busyId === s.id}
                      className="shrink-0 text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <LogOut size={14} /> ログアウト
                    </button>
                  </li>
                );
              })}
              {sessions.length === 0 && (
                <li className="text-center text-sm text-gray-400 py-8">有効なセッションがありません</li>
              )}
            </ul>

            {others.length > 0 && (
              <button
                onClick={revokeOthers}
                disabled={busyId === "others"}
                className={`${c.btn} w-full text-white font-bold py-3 rounded-lg disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2`}
              >
                <LogOut size={16} /> 現在の端末以外をすべてログアウト（{others.length}件）
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
