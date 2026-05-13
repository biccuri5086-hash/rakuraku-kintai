"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LiffContextValue = {
  isReady: boolean;
  isInClient: boolean;
  profile: LiffProfile | null;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const LiffContext = createContext<LiffContextValue>({
  isReady: false,
  isInClient: false,
  profile: null,
  authedFetch: () => Promise.reject(new Error("LIFF not initialized")),
});

export function useLiff() {
  return useContext(LiffContext);
}

const DEMO_PROFILE: LiffProfile = {
  userId: "demo_user_001",
  displayName: "デモ 太郎",
  pictureUrl: undefined,
};

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isInClient, setIsInClient] = useState(false);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const tokenGetter = useRef<() => string | null>(() => null);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

    if (!liffId || liffId === "YOUR_LIFF_ID_HERE") {
      setProfile(DEMO_PROFILE);
      setIsInClient(false);
      setIsReady(true);
      return;
    }

    import("@line/liff").then(({ default: liff }) => {
      liff
        .init({ liffId })
        .then(() => {
          setIsInClient(liff.isInClient());
          if (liff.isLoggedIn()) {
            tokenGetter.current = () => liff.getAccessToken();
            return liff.getProfile().then((p) => {
              setProfile({
                userId: p.userId,
                displayName: p.displayName,
                pictureUrl: p.pictureUrl,
              });
              setIsReady(true);
            });
          } else {
            liff.login();
          }
        })
        .catch(() => {
          setProfile(DEMO_PROFILE);
          setIsReady(true);
        });
    });
  }, []);

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
    <LiffContext.Provider value={{ isReady, isInClient, profile, authedFetch }}>
      {children}
    </LiffContext.Provider>
  );
}
