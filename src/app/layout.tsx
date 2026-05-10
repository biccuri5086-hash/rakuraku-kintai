import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { LiffProvider } from "@/components/LiffProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ラクラク勤怠",
  description: "派遣社員向け1タップ勤怠アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-gray-50">
        <LiffProvider>{children}</LiffProvider>
      </body>
    </html>
  );
}
