import Link from "next/link";

export default function LpPage() {
  return (
    <div className="max-w-2xl mx-auto">
      {/* ヒーロー */}
      <div className="bg-[#06C755] text-white px-6 py-12 text-center">
        <h1 className="text-3xl font-bold mb-3 leading-tight">
          派遣スタッフの離職を<br />LINEで防ぐ。
        </h1>
        <p className="text-green-100 text-base mb-6">
          1タップ打刻 ＋ コンディション報告で<br />
          スタッフの「しんどい」を早期に発見
        </p>
        <a
          href="https://liff.line.me/2010014245-i7LMCgYl"
          className="inline-block bg-white text-[#06C755] font-bold px-8 py-3 rounded-full text-lg shadow-lg"
        >
          無料で試してみる →
        </a>
        <p className="text-green-200 text-xs mt-3">30日間無料・クレジットカード不要</p>
      </div>

      {/* 課題 */}
      <div className="px-6 py-10 bg-gray-50">
        <h2 className="text-xl font-bold text-gray-800 text-center mb-6">こんなお悩みはありませんか？</h2>
        <div className="space-y-3">
          {[
            ["😰", "スタッフが突然来なくなった"],
            ["📋", "打刻修正の依頼が毎週来て手間"],
            ["📱", "専用アプリを入れてくれないスタッフがいる"],
          ].map(([emoji, text]) => (
            <div key={text} className="bg-white rounded-xl p-4 flex items-center gap-3 shadow-sm">
              <span className="text-2xl">{emoji}</span>
              <span className="font-medium text-gray-700">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ソリューション */}
      <div className="px-6 py-10 bg-white">
        <h2 className="text-xl font-bold text-gray-800 text-center mb-6">ラクラク勤怠が解決します</h2>
        <div className="space-y-4">
          {[
            { icon: "👆", title: "1タップ打刻", desc: "LINEを開いてボタンを押すだけ。アプリDL不要で当日から使えます。", color: "bg-green-50 border-green-200" },
            { icon: "😊", title: "コンディション報告", desc: "5段階の絵文字で今日の調子を報告。5秒で完了します。", color: "bg-yellow-50 border-yellow-200" },
            { icon: "🔔", title: "管理者アラート", desc: "調子が悪いスタッフを即座に可視化。離職サインを見逃しません。", color: "bg-red-50 border-red-200" },
          ].map((f) => (
            <div key={f.title} className={`rounded-xl p-4 border ${f.color}`}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{f.icon}</span>
                <h3 className="font-bold text-gray-800">{f.title}</h3>
              </div>
              <p className="text-sm text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 料金 */}
      <div className="px-6 py-10 bg-gray-50">
        <h2 className="text-xl font-bold text-gray-800 text-center mb-6">シンプルな料金プラン</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
            <p className="text-sm text-gray-500 mb-1">スターター</p>
            <p className="text-2xl font-bold text-[#06C755]">150円</p>
            <p className="text-xs text-gray-400">/人/月</p>
          </div>
          <div className="bg-[#06C755] rounded-xl p-4 text-center text-white">
            <p className="text-xs mb-1">★ 推奨</p>
            <p className="text-sm mb-1">スタンダード</p>
            <p className="text-2xl font-bold">200円</p>
            <p className="text-xs text-green-100">/人/月</p>
          </div>
        </div>
        <div className="mt-4 bg-green-50 rounded-xl p-4 text-center border border-green-200">
          <p className="font-bold text-[#06C755]">🎁 30日間・全機能・無料トライアル</p>
          <p className="text-xs text-gray-500 mt-1">クレジットカード不要・違約金なし</p>
        </div>
      </div>

      {/* CTA */}
      <div className="px-6 py-10 bg-[#06C755] text-center">
        <h2 className="text-xl font-bold text-white mb-4">まずは無料でお試しください</h2>
        <a
          href="https://liff.line.me/2010014245-i7LMCgYl"
          className="inline-block bg-white text-[#06C755] font-bold px-8 py-3 rounded-full text-lg shadow-lg mb-4"
        >
          LINEで無料体験 →
        </a>
        <p className="text-green-100 text-sm">お問い合わせ：（メールアドレスを追記してください）</p>
      </div>

      {/* フッター */}
      <div className="px-6 py-4 bg-white border-t border-gray-100 flex justify-center gap-4 text-xs text-gray-400">
        <Link href="/terms">利用規約</Link>
        <Link href="/privacy">プライバシーポリシー</Link>
        <Link href="/legal">特定商取引法</Link>
      </div>
    </div>
  );
}
