"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, Copy, CheckCircle, AlertTriangle, KeyRound } from "lucide-react";

export default function Admin2FASetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentlyEnabled, setCurrentlyEnabled] = useState(false);
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 無効化は本人確認が要るので、パスワードの入力欄を出してから実行する
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  const fetchSetup = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/2fa-setup", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    if (data.ok) {
      setCurrentlyEnabled(data.currentlyEnabled);
      setSecret(data.newSecret);
      setQrDataUrl(data.qrDataUrl ?? "");
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchSetup(); }, [fetchSetup]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* クリップボードが使えない環境では手入力してもらう */
    }
  };

  // まず6桁を検証する。ここではまだ有効化しない
  const handleVerify = async () => {
    setBusy(true);
    setCodeInvalid(false);
    const res = await fetch("/api/admin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code: testCode, action: "verify" }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok && data.valid) setVerified(true);
    else { setVerified(false); setCodeInvalid(true); }
  };

  const handleEnable = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code: testCode, action: "enable" }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok && data.saved) {
      setMessage("2要素認証を有効にしました。次回のログインから6桁コードが必要になります。");
      setCurrentlyEnabled(true);
      setVerified(false);
      setTestCode("");
    } else {
      setMessage("有効化できませんでした。コードの有効時間が過ぎた可能性があります。新しいコードでやり直してください。");
      setVerified(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setDisableError(null);
    const res = await fetch("/api/admin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable", password: disablePassword }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok && data.disabled) {
      setMessage("2要素認証を無効にしました。パスワードだけでログインできる状態です。");
      setCurrentlyEnabled(false);
      setDisabling(false);
      setDisablePassword("");
      await fetchSetup();
    } else {
      setDisableError(data.message ?? "無効化できませんでした");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button onClick={() => router.push("/admin")} className="p-1" aria-label="管理画面に戻る">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-1.5">
            <Shield size={18} /> 2要素認証
          </h1>
          <p className="text-xs text-green-50">ログイン時に、スマホの6桁コードも使います</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {message && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-800">{message}</div>
        )}

        {currentlyEnabled ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle size={20} className="text-green-600" />
                <p className="text-sm text-green-800"><strong>2要素認証は有効です。</strong></p>
              </div>
              {!disabling && (
                <button
                  onClick={() => { setDisabling(true); setDisableError(null); }}
                  className="text-xs font-bold text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50"
                >
                  無効にする
                </button>
              )}
            </div>

            {disabling && (
              <div className="bg-white border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-700 font-bold">
                  無効にすると、パスワードだけでログインできる状態に戻ります。
                </p>
                <p className="text-xs text-gray-600">確認のため、現在のパスワードを入力してください。</p>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(e) => { setDisablePassword(e.target.value); setDisableError(null); }}
                  placeholder="現在のパスワード"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400 text-gray-800"
                />
                {disableError && <p className="text-xs text-red-600 font-bold">{disableError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDisabling(false); setDisablePassword(""); setDisableError(null); }}
                    className="flex-1 border border-gray-200 text-gray-700 text-sm font-bold py-2 rounded-lg"
                  >
                    やめる
                  </button>
                  <button
                    onClick={handleDisable}
                    disabled={busy || !disablePassword}
                    className="flex-1 bg-red-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-bold py-2 rounded-lg"
                  >
                    {busy ? "処理中..." : "無効にする"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-2">
            <AlertTriangle size={20} className="text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-orange-800 font-bold">2要素認証はまだ設定されていません</p>
              <p className="text-xs text-orange-700 mt-1">
                この画面ではスタッフの給与額や連絡先を扱います。パスワードが漏れても、
                スマホが手元になければ入れない状態にしておくことをおすすめします。
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-5 space-y-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <KeyRound size={18} /> 手順1：認証アプリに登録する
          </h2>
          <p className="text-sm text-gray-600">
            スマホに <strong>Google Authenticator</strong>（App Store / Google Play で無料）などの認証アプリを入れて、
            下のQRコードを読み取ってください。1Password や Microsoft Authenticator でも使えます。
          </p>

          {qrDataUrl && (
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="2要素認証のQRコード" width={240} height={240}
                className="border-2 border-gray-200 rounded-xl" />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              QRを読み取れないときは、この文字列を手入力
            </label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 font-mono text-sm bg-gray-50 p-3 rounded-lg break-all select-all">{secret}</code>
              <button
                onClick={handleCopy}
                aria-label="シークレットキーをコピー"
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${
                  copied ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                }`}
              >
                {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <KeyRound size={18} /> 手順2：6桁コードを確かめて有効にする
          </h2>
          <p className="text-sm text-gray-600">
            登録すると認証アプリに6桁の数字が表示されます。30秒ごとに変わるので、いま出ている数字を入力してください。
          </p>

          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={testCode}
              onChange={(e) => {
                setTestCode(e.target.value.replace(/\D/g, ""));
                setCodeInvalid(false);
                setVerified(false);
              }}
              placeholder="123456"
              className="flex-1 min-w-0 border-2 border-gray-200 rounded-xl px-4 py-3 text-2xl font-mono text-center tracking-widest focus:outline-none focus:border-[#06C755] text-gray-800"
            />
            {verified ? (
              <button
                onClick={handleEnable}
                disabled={busy}
                className="bg-[#06C755] disabled:bg-gray-200 disabled:text-gray-400 text-white px-5 py-3 rounded-xl font-bold whitespace-nowrap"
              >
                {busy ? "処理中..." : "有効にする"}
              </button>
            ) : (
              <button
                onClick={handleVerify}
                disabled={busy || testCode.length !== 6}
                className="bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white px-5 py-3 rounded-xl font-bold whitespace-nowrap"
              >
                {busy ? "確認中..." : "確認"}
              </button>
            )}
          </div>

          {verified && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle size={18} className="text-green-600 shrink-0" />
              <p className="text-sm text-green-800 font-bold">コードを確認できました。「有効にする」を押すと設定が完了します。</p>
            </div>
          )}
          {codeInvalid && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600 shrink-0" />
              <p className="text-sm text-red-800 font-bold">
                コードが違います。認証アプリに表示されている新しい数字で、もう一度お試しください。
              </p>
            </div>
          )}
        </div>

        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm text-red-800 font-bold mb-1.5">設定する前にお読みください</p>
          <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
            <li>QRコードと文字列は、他の人に見せないでください</li>
            <li>スマホを機種変更する前に、この画面で登録し直してください</li>
            <li>スマホを失くすとログインできなくなります。その場合はサービス提供元にご連絡ください（解除できます）</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
