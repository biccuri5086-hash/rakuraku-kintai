"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LiffContextValue = {
  isReady: boolean;
  isInClient: boolean;
  profile: LiffProfile | null;
  /** LIFFの初期化に失敗した理由（画面に出してユーザーに知らせる） */
  error: string | null;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const LiffContext = createContext<LiffContextValue>({
  isReady: false,
  isInClient: false,
  profile: null,
  error: null,
  authedFetch: () => Promise.reject(new Error("LIFF not initialized")),
});

export function useLiff() {
  return useContext(LiffContext);
}

// LIFF（＝LINEログイン）を必要とするのは「スタッフ用アプリ」だけ。
//
// LiffProvider はルートレイアウトに置かれているため全ページを包む。
// 以前はパスに関係なく liff.init() → 未ログインなら liff.login() を呼んでいたので、
// 管理者ログイン(/admin/login)・運営者ログイン(/superadmin/login)・LP(/lp) を
// PCブラウザで開いただけでLINEのログイン画面に飛ばされていた。
// LINEアカウントを持たない派遣会社の担当者は、そもそも管理画面に入れない。
//
// そのため、LIFFを起動するパスを明示的に列挙する。ここに無いパスでは
// @line/liff を読み込みすらしない。
const LIFF_PATHS = new Set(["/", "/register", "/condition"]);

function needsLiff(pathname: string | null): boolean {
  if (!pathname) return false;
  return LIFF_PATHS.has(pathname);
}

const DEMO_PROFILE: LiffProfile = {
  userId: "demo_user_001",
  displayName: "デモ 太郎",
  pictureUrl: undefined,
};

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const liffRequired = needsLiff(pathname);

  const [isReady, setIsReady] = useState(false);
  const [isInClient, setIsInClient] = useState(false);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenGetter = useRef<() => string | null>(() => null);

  useEffect(() => {
    // 管理画面・運営画面・LP など、スタッフ用アプリ以外では何もしない。
    if (!liffRequired) {
      setIsReady(true);
      return;
    }

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

    // LIFF ID 未設定のローカル開発用。本番では NEXT_PUBLIC_LIFF_ID が必ず入る。
    if (!liffId || liffId === "YOUR_LIFF_ID_HERE") {
      setProfile(DEMO_PROFILE);
      setIsInClient(false);
      setIsReady(true);
      return;
    }

    let cancelled = false;

    import("@line/liff")
      .then(({ default: liff }) =>
        liff.init({ liffId }).then(() => {
          if (cancelled) return;
          setIsInClient(liff.isInClient());
          if (!liff.isLoggedIn()) {
            liff.login();
            return;
          }
          tokenGetter.current = () => liff.getAccessToken();
          return liff.getProfile().then((p) => {
            if (cancelled) return;
            setProfile({
              userId: p.userId,
              displayName: p.displayName,
              pictureUrl: p.pictureUrl,
            });
            setIsReady(true);
          });
        })
      )
      .catch(() => {
        if (cancelled) return;
        // 以前はここでデモ用プロフィールを表示していたため、実際には打刻できないのに
        // 「デモ 太郎」で打刻できたように見えてしまっていた。原因を伝えて止める。
        setError("LINEとの連携に失敗しました。LINEアプリから開き直してください。");
        setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [liffRequired]);

  const authedFetch: LiffContextValue["authedFetch"] = (input, init = {}) => {
    const token = tokenGetter.current();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    return fetch(input, { ...init, headers });
  };

  return (
    <LiffContext.Provider value={{ isReady, isInClient, profile, error, authedFetch }}>
      {children}
    </LiffContext.Provider>
  );
}
