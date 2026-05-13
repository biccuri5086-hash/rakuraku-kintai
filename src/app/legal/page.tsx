import Link from "next/link";

export default function LegalPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-[#06C755] mb-4 inline-block">← ホームに戻る</Link>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">特定商取引法に基づく表記</h1>
      <p className="text-sm text-gray-400 mb-6">最終更新日：2026年5月13日</p>

      <table className="w-full text-sm border-collapse">
        <tbody>
          {[
            ["販売事業者名", "（事業者名を記入してください）"],
            ["代表者名", "（代表者名を記入してください）"],
            ["所在地", "（住所を記入してください）"],
            ["電話番号", "（電話番号を記入してください）\n※お問い合わせはメールにてお願いします"],
            ["メールアドレス", "（メールアドレスを記入してください）"],
            ["サービス名", "ラクラク勤怠"],
            ["販売価格", "スタータープラン：150円/人/月\nスタンダードプラン：200円/人/月\n（税込・詳細は料金ページ参照）"],
            ["支払方法", "クレジットカード（VISA / Mastercard / JCB）\n銀行振込（別途ご案内）"],
            ["支払時期", "月払い：毎月1日に翌月分を請求\n年払い：契約時に一括請求"],
            ["サービス提供時期", "お申し込み後、即時ご利用可能"],
            ["返金・キャンセル", "月単位の契約のため、翌月以降の解約はいつでも可能。\n日割り返金は行いません。\n無料トライアル期間中の費用は発生しません。"],
            ["動作環境", "LINEアプリがインストールされたスマートフォン\n（iOS / Android）"],
          ].map(([label, value]) => (
            <tr key={label} className="border-b border-gray-100">
              <td className="py-3 pr-4 font-semibold text-gray-600 w-36 align-top">{label}</td>
              <td className="py-3 text-gray-800 whitespace-pre-line">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
