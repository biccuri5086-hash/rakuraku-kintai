"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, Copy, CheckCircle, AlertTriangle, KeyRound } from "lucide-react";

export default function Setup2FAPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentlyEnabled, setCurrentlyEnabled] = useState(false);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [testResult, setTestResult] = useState<"none" | "valid" | "invalid">("none");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" }).then((res) => {
      if (res.ok) setAuthed(true);
      else router.replace("/admin/login");
    });
  }, [router]);

  const fetchSetup = async () => {
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
      setOtpauthUrl(data.otpauthUrl);
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

  const handleTest = async () => {
    if (!/^\d{6}$/.test(testCode)) {
      setTestResult("invalid");
      return;
    }
    setTesting(true);
    setTestResult("none");
    const res = await fetch("/api/admin/2fa-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code: testCode }),
    });
    const data = await res.json();
    setTestResult(data.ok && data.valid ? "valid" : "invalid");
    setTesting(false);
  };

  const qrUrl = otpauthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(otpauthUrl)}`
    : "";

  if (!authed || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-4 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button onClick={() => router.push("/admin")} className="p-1">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-1.5">
            <Shield size={18} /> 2要素認証セットアップ
          </h1>
          <p className="text-xs text-green-100">Google Authenticator 等で使う 6桁コード</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {currentlyEnabled ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-2">
            <CheckCircle size={20} className="text-green-600" />
            <p className="text-sm text-green-800">
              <strong>2FAは現在有効です</strong>。新しいシークレットに変更したい場合のみ、以下を進めてください。
            </p>
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-2">
            <AlertTriangle size={20} className="text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-orange-800 font-bold">2FAは現在無効です</p>
              <p className="text-xs text-orange-700 mt-1">
                以下の手順でVercelに環境変数を追加し、再デプロイすると有効化されます。
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-5 space-y-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <KeyRound size={18} /> STEP 1：認証アプリに登録
          </h2>
          <p className="text-sm text-gray-600">
            Google Authenticator / Microsoft Authenticator / 1Password などの認証アプリで、以下のQRコードをスキャンするか、シークレットを手動入力してください。
          </p>

          {qrUrl && (
            <div className="flex justify-center">
              <img src={qrUrl} alt="2FA QR Code" className="border-2 border-gray-200 rounded-xl" />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              シークレットキー（手動入力用）
            </label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 font-mono text-sm bg-gray-50 p-3 rounded-lg break-all select-all">
                {secret}
              </code>
              <button
                onClick={() => handleCopy(secret)}
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${
                  copied ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                }`}
              >
                {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <KeyRound size={18} /> STEP 2：6桁コードでテスト
          </h2>
          <p className="text-sm text-gray-600">
            認証アプリに表示されている6桁の数字を入力して、正しく動作するか確認してください。
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
                setTestResult("none");
              }}
              placeholder="123456"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-2xl font-mono text-center tracking-widest focus:outline-none focus:border-[#06C755]"
            />
            <button
              onClick={handleTest}
              disabled={testing || testCode.length !== 6}
              className="bg-[#06C755] disabled:bg-gray-200 text-white px-5 py-3 rounded-xl font-bold"
            >
              {testing ? "確認中..." : "テスト"}
            </button>
          </div>

          {testResult === "valid" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle size={18} className="text-green-600" />
              <p className="text-sm text-green-800 font-bold">コードは正しいです！STEP 3 に進んでください。</p>
            </div>
          )}
          {testResult === "invalid" && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600" />
              <p className="text-sm text-red-800 font-bold">コードが違います。30秒後の更新されたコードで再試行してください。</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <KeyRound size={18} /> STEP 3：Vercelに環境変数を登録
          </h2>
          <p className="text-sm text-gray-600">
            Vercel ダッシュボード → Settings → Environment Variables で以下を追加：
          </p>
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="text-xs">
              <span className="text-gray-500">Key:</span>{" "}
              <code className="font-mono bg-white px-2 py-0.5 rounded">ADMIN_TOTP_SECRET</code>
            </div>
            <div className="text-xs">
              <span className="text-gray-500">Value:</span>{" "}
              <code className="font-mono bg-white px-2 py-0.5 rounded break-all">{secret}</code>
            </div>
            <div className="text-xs">
              <span className="text-gray-500">Environment:</span> Production / Preview / Development すべてチェック
            </div>
          </div>
          <p className="text-xs text-gray-500">
            登録後、Deployments → 最新 → ⋯ → <strong>Redeploy</strong> を実行してください。次回のログインから 2FA が必要になります。
          </p>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm text-red-800 font-bold mb-1">⚠️ 重要</p>
          <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
            <li>シークレットキーは絶対に他人に見せないでください</li>
            <li>認証アプリを別の端末にも登録しておくと、機種変更時に困りません</li>
            <li>シークレットを紛失すると管理画面に入れなくなります</li>
            <li>緊急時は Vercel から ADMIN_TOTP_SECRET を削除すると 2FA が無効化されます</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
