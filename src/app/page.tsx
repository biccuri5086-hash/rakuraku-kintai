"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useLiff } from "@/components/LiffProvider";
import { Clock, LogIn, LogOut, CheckCircle, User, MapPin, AlertCircle } from "lucide-react";
import { Footer } from "@/components/Footer";

type TodayRecord = {
  clockIn: string | null;
  clockOut: string | null;
  /** 前回の退勤打刻が漏れている（管理者の確認が必要） */
  stale: boolean;
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

type Features = { feature_condition: boolean; feature_gps: boolean };

export default function HomePage() {
  const { isReady, profile, error: liffError, authedFetch } = useLiff();
  const router = useRouter();
  const [now, setNow] = useState(new Date());
  const [todayRecord, setTodayRecord] = useState<TodayRecord>({ clockIn: null, clockOut: null, stale: false });
  const [loading, setLoading] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "acquiring" | "done">("idle");
  const [tapped, setTapped] = useState(false);
  const [clockInDone, setClockInDone] = useState(false);
  const [doneType, setDoneType] = useState<"in" | "out">("in");
  const [clockError, setClockError] = useState<string | null>(null);
  const [features, setFeatures] = useState<Features>({ feature_condition: true, feature_gps: true });
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isReady || !profile) return;
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      try { sessionStorage.setItem("rk_invite", invite); } catch {}
    }
    authedFetch("/api/me/profile", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok || !data.profile?.phone) {
          router.replace("/register");
        } else {
          if (data.settings) {
            setFeatures({
              feature_condition: !!data.settings.feature_condition,
              feature_gps: !!data.settings.feature_gps,
            });
          }
          if (data.company?.name) setCompanyName(data.company.name);
          setProfileChecked(true);
        }
      })
      .catch(() => router.replace("/register"));
  }, [isReady, profile, router, authedFetch]);

  useEffect(() => {
    if (!profile || !profileChecked) return;
    authedFetch("/api/me/today", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setTodayRecord({ clockIn: data.clockIn, clockOut: data.clockOut, stale: !!data.stale });
        }
      });
  }, [profile, profileChecked, tapped, authedFetch]);

  const handleClock = async () => {
    if (!profile || loading) return;
    const type = todayRecord.clockIn && !todayRecord.clockOut ? "clock_out" : "clock_in";
    setClockError(null);
    setLoading(true);

    const res = await authedFetch("/api/me/clock", {
      method: "POST",
      body: JSON.stringify({ type }),
    });
    const data = await res.json();

    if (!data.ok) {
      setClockError(data.message ?? "打刻に失敗しました。時間をおいてお試しください");
      setLoading(false);
      return;
    }

    setTapped((v) => !v); // 打刻後に当日データを再取得
    if (type === "clock_in") {
      // 出勤：GPSで就業場所を記録。コンディションは聞かない（退勤時に聞く）。
      if (features.feature_gps && navigator.geolocation) {
        setGpsStatus("acquiring");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const gps = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            };
            setGpsStatus("done");
            authedFetch("/api/me/gps", {
              method: "POST",
              body: JSON.stringify({ attendanceId: data.attendanceId, ...gps }),
            });
          },
          () => setGpsStatus("done"),
          { timeout: 10000, maximumAge: 0 }
        );
      }
      setDoneType("in");
      setClockInDone(true);
      setTimeout(() => setClockInDone(false), 2500);
    } else {
      // 退勤：ここでコンディション（体調）を聞く。
      setDoneType("out");
      setClockInDone(true);
      if (features.feature_condition) {
        setTimeout(() => router.push("/condition"), 3000);
      } else {
        setTimeout(() => setClockInDone(false), 2500);
      }
    }
    setLoading(false);
  };

  const isWorkingNow = !!todayRecord.clockIn && !todayRecord.clockOut;
  const isDone = !!todayRecord.clockIn && !!todayRecord.clockOut;

  if (liffError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
          <AlertCircle size={26} className="text-red-500" />
        </div>
        <p className="text-gray-700 font-bold">開けませんでした</p>
        <p className="text-gray-500 text-sm leading-relaxed">{liffError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 bg-[#06C755] text-white font-bold px-6 py-2.5 rounded-lg"
        >
          再読み込み
        </button>
      </div>
    );
  }

  if (!isReady || !profileChecked) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  if (clockInDone) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-[#06C755]">
        <CheckCircle size={72} className="text-white animate-bounce" />
        <p className="text-white text-2xl font-bold">
          {doneType === "in" ? "出勤しました！" : "退勤しました！"}
        </p>
        {doneType === "out" && features.feature_condition && (
          <p className="text-green-100 text-sm">コンディションを教えてください...</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold tracking-wide">ラクラク勤怠</h1>
          {companyName && <p className="text-[10px] text-green-100">{companyName}</p>}
        </div>
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
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-gray-500 text-sm">{formatDate(now)}</p>
          <p className="text-4xl font-bold text-gray-800 tabular-nums mt-1">
            {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>

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

        {clockError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {clockError}
          </div>
        )}

        {todayRecord.stale && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">
            前回の退勤打刻が記録されていません。担当者にご確認ください。
          </div>
        )}

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

        {features.feature_condition && (
          <button
            onClick={() => router.push("/condition")}
            className="bg-white border border-gray-200 rounded-2xl shadow p-4 text-center text-gray-600 font-medium hover:bg-gray-50 transition-colors"
          >
            😊 コンディション報告
          </button>
        )}
      </main>
      <Footer />
    </div>
  );
}
