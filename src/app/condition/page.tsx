"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiff } from "@/components/LiffProvider";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Send, CheckCircle } from "lucide-react";

const CONDITIONS = [
  { score: 5, emoji: "😄", label: "絶好調！", color: "bg-green-100 border-green-400 text-green-700" },
  { score: 4, emoji: "😊", label: "良い感じ", color: "bg-lime-100 border-lime-400 text-lime-700" },
  { score: 3, emoji: "😐", label: "普通", color: "bg-yellow-100 border-yellow-400 text-yellow-700" },
  { score: 2, emoji: "😔", label: "少し疲れ", color: "bg-orange-100 border-orange-400 text-orange-700" },
  { score: 1, emoji: "😢", label: "しんどい", color: "bg-red-100 border-red-400 text-red-700" },
] as const;

export default function ConditionPage() {
  const { profile } = useLiff();
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!profile || selected === null || loading) return;
    setLoading(true);

    const { error } = await supabase.from("condition_reports").insert({
      user_id: profile.userId,
      score: selected,
      comment: comment.trim() || null,
      reported_at: new Date().toISOString(),
    });

    if (!error) {
      setSubmitted(true);
    }
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6">
        <CheckCircle size={64} className="text-[#06C755]" />
        <h2 className="text-2xl font-bold text-gray-800 text-center">
          報告ありがとうございます！
        </h2>
        <p className="text-gray-500 text-center text-sm leading-relaxed">
          あなたのコンディションを記録しました。<br />
          困ったことがあればいつでも報告してください。
        </p>
        <button
          onClick={() => router.push("/")}
          className="bg-[#06C755] text-white px-8 py-3 rounded-full font-bold shadow-md active:scale-95 transition-transform"
        >
          ホームに戻る
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      {/* ヘッダー */}
      <header className="bg-[#06C755] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button onClick={() => router.push("/")} className="p-1">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold">コンディション報告</h1>
      </header>

      <main className="flex flex-col flex-1 px-4 py-6 gap-6">
        <div className="text-center">
          <p className="text-gray-500 text-sm">
            {profile?.displayName} さん、今日の調子はどうですか？
          </p>
          <h2 className="text-xl font-bold text-gray-800 mt-1">
            今日のコンディションを教えてください
          </h2>
        </div>

        {/* コンディション選択 */}
        <div className="flex flex-col gap-3">
          {CONDITIONS.map((c) => (
            <button
              key={c.score}
              onClick={() => setSelected(c.score)}
              className={`
                flex items-center gap-4 px-5 py-4 rounded-2xl border-2
                transition-all active:scale-95
                ${selected === c.score ? `${c.color} border-2 shadow-md scale-[1.02]` : "bg-white border-gray-200 text-gray-600"}
              `}
            >
              <span className="text-3xl">{c.emoji}</span>
              <span className="text-lg font-bold">{c.label}</span>
              {selected === c.score && (
                <CheckCircle size={20} className="ml-auto" />
              )}
            </button>
          ))}
        </div>

        {/* コメント入力 */}
        <div className="bg-white rounded-2xl shadow p-4">
          <label className="text-sm font-semibold text-gray-500 block mb-2">
            一言コメント（任意）
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="今日の状況を一言で教えてください..."
            maxLength={200}
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-800 focus:outline-none focus:border-[#06C755] placeholder-gray-300"
          />
          <p className="text-right text-xs text-gray-300 mt-1">
            {comment.length}/200
          </p>
        </div>

        {/* 送信ボタン */}
        <button
          onClick={handleSubmit}
          disabled={selected === null || loading}
          className="bg-[#06C755] disabled:bg-gray-300 text-white rounded-2xl py-5 text-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          {loading ? (
            <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Send size={22} />
              送信する
            </>
          )}
        </button>
      </main>
    </div>
  );
}
