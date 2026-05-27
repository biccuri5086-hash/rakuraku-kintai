"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiff } from "@/components/LiffProvider";
import { Phone, CheckCircle, AlertCircle, MapPin, User as UserIcon, Building2 } from "lucide-react";
import { Footer } from "@/components/Footer";

export default function RegisterPage() {
  const { profile, authedFetch } = useLiff();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteChecking, setInviteChecking] = useState(true);
  const [gpsConsent, setGpsConsent] = useState(false);
  const [termsConsent, setTermsConsent] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("invite");
    let stored: string | null = null;
    try { stored = sessionStorage.getItem("rk_invite"); } catch {}
    const code = fromUrl ?? stored;
    if (fromUrl) {
      try { sessionStorage.setItem("rk_invite", fromUrl); } catch {}
    }
    setInviteCode(code);

    (async () => {
      if (!profile) return;
      const meRes = await authedFetch("/api/me/profile", { cache: "no-store" });
      const meData = await meRes.json();
      if (meData.ok && meData.profile?.company_id) {
        setCompanyName(meData.company?.name ?? null);
        setInviteChecking(false);
        return;
      }

      if (!code) {
        setInviteError("招待リンクから開いてください。所属する派遣会社が特定できません。");
        setInviteChecking(false);
        return;
      }
      const res = await fetch(`/api/invite/${encodeURIComponent(code)}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setCompanyName(data.company.name);
      } else {
        setInviteError(data.message ?? "招待リンクが無効です");
      }
      setInviteChecking(false);
    })();
  }, [profile, authedFetch]);

  const handleSubmit = async () => {
    if (!profile || loading) return;
    setError("");
    setLoading(true);

    const res = await authedFetch("/api/me/register", {
      method: "POST",
      body: JSON.stringify({
        phone: input,
        full_name: fullName,
        invite_code: inviteCode ?? undefined,
        gps_consent: gpsConsent,
        terms_consent: termsConsent,
        consented_at: new Date().toISOString(),
      }),
    });
    const data = await res.json();

    if (!data.ok) {
      setError(data.message ?? "登録に失敗しました");
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/"), 1000);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6">
        <CheckCircle size={56} className="text-[#06C755]" />
        <h2 className="text-xl font-bold text-gray-800">登録完了！</h2>
        <p className="text-gray-400 text-sm">ホーム画面に移動します...</p>
      </div>
    );
  }

  if (inviteChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">確認中...</p>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <AlertCircle size={48} className="text-red-400" />
        <h2 className="text-lg font-bold text-gray-800">登録できません</h2>
        <p className="text-sm text-gray-500">{inviteError}</p>
        <p className="text-xs text-gray-400 mt-4">
          所属する派遣会社の管理者から「招待リンク」を共有してもらい、
          そのリンクから開き直してください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <header className="bg-[#06C755] text-white px-4 py-3 shadow-md">
        <h1 className="text-lg font-bold">ラクラク勤怠</h1>
        <p className="text-xs text-green-100">初期設定</p>
      </header>

      <main className="flex flex-col flex-1 px-6 py-8 gap-6">
        {companyName && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex items-center gap-2">
            <Building2 size={20} className="text-[#06C755]" />
            <div>
              <p className="text-xs text-green-600 font-semibold">所属会社</p>
              <p className="text-sm font-bold text-gray-800">{companyName}</p>
            </div>
          </div>
        )}

        <div className="text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Phone size={28} className="text-[#06C755]" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">初回登録</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            本人確認のため、お名前と携帯電話番号を入力してください。
            <br />入力は1回のみです。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-600">
            お名前（本名）
          </label>
          <div className="relative">
            <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setError(""); }}
              placeholder="例：山田 太郎"
              maxLength={50}
              className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 text-lg focus:outline-none focus:border-[#06C755] text-gray-800 placeholder-gray-300"
              autoFocus
            />
          </div>
          <p className="text-xs text-gray-400">
            給与計算・契約書類に使用される正式な氏名です
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-600">
            携帯電話番号
          </label>
          <input
            type="tel"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="例：090-1234-5678"
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-[#06C755] text-gray-800 placeholder-gray-300"
          />
          {error && (
            <div className="flex items-center gap-1.5 text-red-500 text-sm">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <p className="text-xs text-gray-400">
            ハイフンあり・なし、どちらでも入力できます
          </p>
        </div>

        <label className="bg-blue-50 rounded-xl p-3 flex gap-2 items-start border border-blue-100 cursor-pointer">
          <input
            type="checkbox"
            checked={gpsConsent}
            onChange={(e) => setGpsConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#06C755] shrink-0"
          />
          <div className="flex-1">
            <p className="text-xs text-blue-700 font-semibold flex items-center gap-1">
              <MapPin size={14} className="text-blue-500" />
              位置情報（GPS）取得に同意する
            </p>
            <p className="text-xs text-blue-600 leading-relaxed mt-1">
              出勤打刻の正確性を確認するため、打刻時にGPSを取得することがあります。
              取得した位置情報は勤怠確認のためのみ使用され、ブラウザ設定でいつでも無効化できます。
              詳細は<a href="/privacy" className="underline" onClick={(e) => e.stopPropagation()}>プライバシーポリシー</a>。
            </p>
          </div>
        </label>

        <label className="bg-gray-50 rounded-xl p-3 flex gap-2 items-start border border-gray-200 cursor-pointer">
          <input
            type="checkbox"
            checked={termsConsent}
            onChange={(e) => setTermsConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#06C755] shrink-0"
          />
          <p className="text-xs text-gray-700 leading-relaxed flex-1">
            <a href="/terms" className="underline text-[#06C755]" onClick={(e) => e.stopPropagation()}>利用規約</a>
            および
            <a href="/privacy" className="underline text-[#06C755]" onClick={(e) => e.stopPropagation()}>プライバシーポリシー</a>
            に同意します
          </p>
        </label>

        <button
          onClick={handleSubmit}
          disabled={!input || !fullName.trim() || !gpsConsent || !termsConsent || loading}
          className="bg-[#06C755] disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-2xl py-5 text-lg font-bold shadow-lg transition-all active:scale-95 mt-auto"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-4 border-white border-t-transparent rounded-full animate-spin" />
              登録中...
            </div>
          ) : (
            "同意して登録する"
          )}
        </button>
      </main>
      <Footer />
    </div>
  );
}
