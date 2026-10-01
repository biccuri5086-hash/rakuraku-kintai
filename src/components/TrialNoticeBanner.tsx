"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import type { TrialNotice } from "@/lib/billing/trial-notice";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }) : "";

// トライアル終了7日前から出る「続ける／やめる」の選択バナー。該当しない会社には何も出さない。
export default function TrialNoticeBanner() {
  const router = useRouter();
  const [notice, setNotice] = useState<TrialNotice | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/trial-notice", { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      if (data?.ok) setNotice(data.notice);
    } catch { /* 通知は補助表示なので失敗しても画面は止めない */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (decision: "continue" | "stop") => {
    setSaving(true); setErr(null);
    const res = await fetch("/api/admin/trial-notice", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok && data.ok) {
      setConfirmStop(false);
      if (decision === "continue") router.push("/admin/billing");
      else await load();
    } else setErr(data.message ?? "保存に失敗しました");
  };

  if (!notice || notice.phase === "none") return null;
  const expired = notice.phase === "expired";
  const end = fmtDate(notice.endsAt);

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Hourglass size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-bold text-amber-900 text-sm">
            {expired ? "無料トライアルは終了しました" : `無料トライアルはあと${notice.daysLeft}日で終了します`}
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            終了日：{end}。{expired ? "" : "このまま使い続けるか、ここでやめるかを選んでください。"}
            無料プランはありません。続ける場合は有料プランをお選びください。
          </p>
        </div>
      </div>

      {notice.decision === "stop" ? (
        <div className="bg-white rounded-xl border border-amber-200 p-3 text-xs text-gray-700 space-y-2">
          <p className="font-bold">「やめる」を選択済みです。{expired ? "利用を停止しました。" : `${end}の終了とともに利用停止になります。`}</p>
          <p>データは停止から30日間保管され、その後削除されます。気が変わった場合は下のボタンから続けられます。</p>
          <button onClick={() => decide("continue")} disabled={saving}
            className="bg-[#06C755] text-white font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-60">
            やっぱり続ける（プランを選ぶ）
          </button>
        </div>
      ) : confirmStop ? (
        <div className="bg-white rounded-xl border border-red-200 p-3 text-xs text-gray-700 space-y-2">
          <p className="font-bold text-red-700">本当にやめますか？</p>
          <p>{end}の終了とともに利用停止になり、データは30日後に削除されます。終了日までは使えます。</p>
          <div className="flex gap-2">
            <button onClick={() => decide("stop")} disabled={saving}
              className="bg-red-600 text-white font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-60">
              {saving ? "保存中..." : "やめる"}
            </button>
            <button onClick={() => setConfirmStop(false)} disabled={saving}
              className="bg-gray-100 text-gray-600 font-bold text-sm px-4 py-2 rounded-lg">戻る</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => decide("continue")} disabled={saving}
            className="flex-1 bg-[#06C755] text-white font-bold text-sm px-4 py-2.5 rounded-lg disabled:opacity-60">
            続ける（プランを選ぶ）
          </button>
          <button onClick={() => setConfirmStop(true)}
            className="flex-1 bg-white border border-gray-300 text-gray-700 font-bold text-sm px-4 py-2.5 rounded-lg">
            やめる
          </button>
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
