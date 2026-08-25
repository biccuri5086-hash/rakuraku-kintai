"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, Copy, CheckCircle, AlertTriangle, KeyRound } from "lucide-react";

export default function SuperSetup2FAPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentlyEnabled, setCurrentlyEnabled] = useState(false);
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [testResult, setTestResult] = useState<"none" | "invalid">("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/superadmin/me", { cache: "no-store" }).then((res) => {
      if (res.ok) setAuthed(true);
      else router.replace("/superadmin/login");
    });
  }, [router]);

  const fetchSetup = async () => {
    setLoading(true);
    const res = await fetch("/api/superadmin/2fa-setup", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/superadmin/login");
      return;
    }
    const data = await res.json();
    if (data.ok) {
      setCurrentlyEnabled(data.currentlyEnabled);
      setSecret(data.newSecret);
      setQrDataUrl(data.qrDataUrl ?? "");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authed) fetchSetup();
  }, [authed]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // 6桁コードを検証（まだ有効化はしない）
  const handleVerify = async () => {
    if (!/^\d{6}$/.test(testCode)) {
      setTestResult("invalid");
      return;
    }
    setBusy(true);
    setTestResult("none");
    const res = await fetch("/api/superadmin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code: testCode, action: "verify" }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok && data.valid) {
      setVerified(true);
      setTestResult("none");
    } else {
      setVerified(false);
      setTestResult("invalid");
    }
  };

  // 検証済みコードで有効化を確定
  const handleEnable = async () => {
    setBusy(true);
    const res = await fetch("/api/superadmin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code: testCode, action: "enable" }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok && data.saved) {
      setMessage("2FAを有効化しました。次回のログインから6桁コードが必要です。");
      setCurrentlyEnabled(true);
      setVerified(false);
      setTestCode("");
    } else {
      setMessage("有効化に失敗しました。コードが更新されている可能性があります。もう一度お試しください。");
      setVerified(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setDisableError(null);
    const res = await fetch("/api/superadmin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable", password: disablePassword }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok && data.disabled) {
      setMessage("2FAを無効化しました。パスワードだけでログインできる状態です。");
      setCurrentlyEnabled(false);
      setDisabling(false);
      setDisablePassword("");
      await fetchSetup();
    } else {
      setDisableError(data.message ?? "無効化できませんでした");
    }
  };


  if (!authed || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 bg-slate-50">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-slate-900 to-slate-700 text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button onClick={() => router.push("/superadmin")} className="p-1">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-1.5">
            <Shield size={18} /> 2要素認証（運営者専用）
          </h1>
          <p className="text-xs text-amber-300">Google Authenticator 等の6桁コード</p>
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
                <p className="text-sm text-green-800">
                  <strong>2FAは現在有効です。</strong>
                </p>
              </div>
              {!disabling && (
                <button
                  onClick={() => { setDisabling(true); setDisableError(null); }}
                  className="text-xs font-bold text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50"
                >
                  無効化
                </button>
              )}
            </div>

            {disabling && (
              <div className="bg-white border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-700 font-bold">
                  無効化すると、パスワードだけでログインできる状態に戻ります。
                </p>
                <p className="text-xs text-slate-600">確認のため、現在のパスワードを入力してください。</p>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(e) => { setDisablePassword(e.target.value); setDisableError(null); }}
                  placeholder="現在のパスワード"
                  className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400 text-slate-800"
                />
                {disableError && <p className="text-xs text-red-600 font-bold">{disableError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDisabling(false); setDisablePassword(""); setDisableError(null); }}
                    className="flex-1 border border-slate-200 text-slate-700 text-sm font-bold py-2 rounded-lg"
                  >
                    やめる
                  </button>
                  <button
                    onClick={handleDisable}
                    disabled={busy || !disablePassword}
                    className="flex-1 bg-red-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold py-2 rounded-lg"
                  >
                    {busy ? "処理中..." : "無効化する"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-2">
            <AlertTriangle size={20} className="text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-orange-800 font-bold">2FAは現在無効です</p>
              <p className="text-xs text-orange-700 mt-1">
                下の手順でQRを読み取り、6桁コードで確認してから「有効化する」を押すだけで完了します。
                <span className="font-semibold">Vercelの設定は不要です。</span>
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-5 space-y-4">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <KeyRound size={18} /> STEP 1：認証アプリに登録
          </h2>
          <p className="text-sm text-slate-600">
            Google Authenticator / Microsoft Authenticator / 1Password などで、QRコードをスキャンするか、シークレットを手動入力してください。
          </p>

          {qrDataUrl && (
            <div className="flex justify-center">
              {/* サーバー内で生成した data URI。外部サービスにシークレットを渡さない。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="2FA QR Code" width={240} height={240} className="border-2 border-slate-200 rounded-xl" />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              シークレットキー（手動入力用）
            </label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 font-mono text-sm bg-slate-50 p-3 rounded-lg break-all select-all">{secret}</code>
              <button
                onClick={() => handleCopy(secret)}
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${
                  copied ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"
                }`}
              >
                {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <KeyRound size={18} /> STEP 2：6桁コードで確認して有効化
          </h2>
          <p className="text-sm text-slate-600">認証アプリに表示されている6桁を入力してください。</p>

          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={testCode}
              onChange={(e) => {
                setTestCode(e.target.value.replace(/\D/g, ""));
                setTestResult("none");
                setVerified(false);
              }}
              placeholder="123456"
              className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-3 text-2xl font-mono text-center tracking-widest focus:outline-none focus:border-amber-500"
            />
            {verified ? (
              <button
                onClick={handleEnable}
                disabled={busy}
                className="bg-green-600 disabled:bg-slate-200 text-white px-5 py-3 rounded-xl font-bold whitespace-nowrap"
              >
                {busy ? "処理中..." : "有効化する"}
              </button>
            ) : (
              <button
                onClick={handleVerify}
                disabled={busy || testCode.length !== 6}
                className="bg-amber-500 disabled:bg-slate-200 text-white px-5 py-3 rounded-xl font-bold whitespace-nowrap"
              >
                {busy ? "確認中..." : "確認"}
              </button>
            )}
          </div>

          {verified && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle size={18} className="text-green-600" />
              <p className="text-sm text-green-800 font-bold">コードOK。「有効化する」を押すと2FAが有効になります。</p>
            </div>
          )}
          {testResult === "invalid" && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600" />
              <p className="text-sm text-red-800 font-bold">コードが違います。30秒後の新しいコードで再試行してください。</p>
            </div>
          )}
        </div>

        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm text-red-800 font-bold mb-1">⚠️ 重要</p>
          <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
            <li>シークレットキーは絶対に他人に見せないでください</li>
            <li>認証アプリを別の端末にも登録しておくと、機種変更時に安心です</li>
            <li>シークレットと端末を両方失うとログインできなくなります（DBから totp_secret を消せば解除可能）</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
