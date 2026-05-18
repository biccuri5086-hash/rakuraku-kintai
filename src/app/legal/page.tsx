import Link from "next/link";

export default function LegalPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-[#06C755] mb-4 inline-block">← ホームに戻る</Link>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">特定商取引法に基づく表記</h1>
      <p className="text-sm text-gray-400 mb-6">最終更新日：2026年5月19日</p>

      <table className="w-full text-sm border-collapse">
        <tbody>
          {[
            ["販売事業者名", "小原 健太"],
            ["代表者名", "小原 健太"],
            ["所在地", "消費者からの請求があれば遅滞なく開示します"],
            ["電話番号", "080-9895-7770\n※対応時間：平日 10:00-18:00（土日祝休）\n※お問い合わせは原則メールにてお願いします"],
            ["メールアドレス", "biccuri5086@gmail.com"],
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

      <div className="mt-8 p-4 bg-gray-50 rounded-lg text-xs text-gray-500 leading-relaxed">
        <p className="font-semibold mb-1">所在地の開示について</p>
        <p>
          消費者庁ガイドラインに基づき、個人事業主としての所在地は
          消費者からの請求があった場合に遅滞なく開示いたします。
          開示をご希望の場合は、上記メールアドレスまでご連絡ください。
        </p>
      </div>
    </div>
  );
}
