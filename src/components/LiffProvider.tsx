"use client";

import { createContext, useContext, useEffect, useState } from "react";

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LiffContextValue = {
  isReady: boolean;
  isInClient: boolean;
  profile: LiffProfile | null;
};

const LiffContext = createContext<LiffContextValue>({
  isReady: false,
  isInClient: false,
  profile: null,
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
          // LIFF初期化失敗時はデモモードで継続
          setProfile(DEMO_PROFILE);
          setIsReady(true);
        });
    });
  }, []);

  return (
    <LiffContext.Provider value={{ isReady, isInClient, profile }}>
      {children}
    </LiffContext.Provider>
  );
}
