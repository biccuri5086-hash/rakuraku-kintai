"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useLiff } from "@/components/LiffProvider";
import { getSupabase, getUserProfile, updateAttendanceGps } from "@/lib/supabase";
import { Clock, LogIn, LogOut, CheckCircle, User, MapPin } from "lucide-react";

type TodayRecord = {
  clockIn: string | null;
  clockOut: string | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default function HomePage() {
  const { isReady, profile } = useLiff();
  const router = useRouter();
  const [now, setNow] = useState(new Date());
  const [todayRecord, setTodayRecord] = useState<TodayRecord>({ clockIn: null, clockOut: null });
  const [loading, setLoading] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "acquiring" | "done">("idle");
  const [tapped, setTapped] = useState(false);

  // 時計
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 初期登録チェック
  useEffect(() => {
    if (!isReady || !profile) return;
    getUserProfile(profile.userId).then((p) => {
      if (!p || !p.phone) {
        router.replace("/register");
      } else {
        setProfileChecked(true);
      }
    });
  }, [isReady, profile, router]);

  // 今日の打刻取得
  useEffect(() => {
    if (!profile || !profileChecked) return;
    const today = new Date().toISOString().split("T")[0];
    getSupabase()
      .from("attendance")
      .select("*")
      .eq("user_id", profile.userId)
      .gte("timestamp", `${today}T00:00:00`)
      .order("timestamp", { ascending: true })
      .then(({ data }) => {
        if (data) {
          const ci = data.find((r) => r.type === "clock_in");
          const co = data.find((r) => r.type === "clock_out");
          setTodayRecord({ clockIn: ci?.timestamp ?? null, clockOut: co?.timestamp ?? null });
        }
      });
  }, [profile, profileChecked, tapped]);

  const handleClock = async () => {
    if (!profile || loading) return;
    const type = todayRecord.clockIn && !todayRecord.clockOut ? "clock_out" : "clock_in";
    setLoading(true);

    const { data, error } = await getSupabase()
      .from("attendance")
      .insert({
        user_id: profile.userId,
        user_name: profile.displayName,
        type,
        timestamp: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!error && data) {
      // GPS取得を非同期でバックグラウンド実行（UIをブロックしない）
      if (type === "clock_in") {
        setGpsStatus("acquiring");
        updateAttendanceGps(data.id);
        setTimeout(() => setGpsStatus("done"), 8000);
      }
      setTapped((v) => !v);
      if (type === "clock_in") router.push("/condition");
    }
    setLoading(false);
  };

  const isWorkingNow = !!todayRecord.clockIn && !todayRecord.clockOut;
  const isDone = !!todayRecord.clockIn && !!todayRecord.clockOut;

  if (!isReady || !profileChecked) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      {/* ヘッダー */}
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <h1 className="text-lg font-bold tracking-wide">ラクラク勤怠</h1>
        <div className="flex items-center gap-2">
          {profile?.pictureUrl ? (
            <Image
              src={profile.pictureUrl}
              alt={profile.displayName}
              width={32}
              height={32}
              className="rounded-full border-2 border-white"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center">
              <User size={16} />
            </div>
          )}
          <span className="text-sm font-medium">{profile?.displayName}</span>
        </div>
      </header>

      <main className="flex flex-col flex-1 px-4 py-6 gap-5">
        {/* 日付・時刻 */}
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-gray-500 text-sm">{formatDate(now)}</p>
          <p className="text-4xl font-bold text-gray-800 tabular-nums mt-1">
            {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>

        {/* ステータスカード */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">本日の状況</h2>
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${
              isDone ? "bg-gray-100 text-gray-600"
              : isWorkingNow ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-400"
            }`}>
              {isDone ? <><CheckCircle size={14} /> 退勤済み</>
               : isWorkingNow ? <><Clock size={14} /> 出勤中</>
               : "未出勤"}
            </span>
            {gpsStatus === "acquiring" && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-500 bg-blue-50 px-2 py-1 rounded-full">
                <MapPin size={12} className="animate-pulse" /> GPS取得中...
              </span>
            )}
            {gpsStatus === "done" && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                <MapPin size={12} /> 位置記録済み
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">出勤</p>
              <p className="text-xl font-bold text-gray-800">
                {todayRecord.clockIn ? formatTime(todayRecord.clockIn) : "--:--"}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">退勤</p>
              <p className="text-xl font-bold text-gray-800">
                {todayRecord.clockOut ? formatTime(todayRecord.clockOut) : "--:--"}
              </p>
            </div>
          </div>
        </div>

        {/* 打刻ボタン */}
        {!isDone && (
          <button
            onClick={handleClock}
            disabled={loading}
            className={`${isWorkingNow ? "bg-orange-500 active:bg-orange-600" : "bg-[#06C755] active:bg-green-600"}
              text-white rounded-2xl shadow-lg flex flex-col items-center justify-center gap-2
              py-10 text-2xl font-bold transition-transform active:scale-95 disabled:opacity-60`}
          >
            {loading ? (
              <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {isWorkingNow ? <LogOut size={32} /> : <LogIn size={32} />}
                {isWorkingNow ? "退勤する" : "出勤する"}
              </>
            )}
          </button>
        )}

        {/* コンディション報告リンク */}
        <button
          onClick={() => router.push("/condition")}
          className="bg-white border border-gray-200 rounded-2xl shadow p-4 text-center text-gray-600 font-medium hover:bg-gray-50 transition-colors"
        >
          😊 コンディション報告
        </button>

        {/* 管理者リンク */}
        <button
          onClick={() => router.push("/admin")}
          className="text-xs text-gray-300 hover:text-gray-400 text-center py-1 transition-colors"
        >
          管理者ダッシュボード →
        </button>
      </main>
    </div>
  );
}
