import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-[#06C755] mb-4 inline-block">← ホームに戻る</Link>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">利用規約</h1>
      <p className="text-sm text-gray-400 mb-6">最終更新日：2026年5月13日</p>

      <div className="prose prose-sm text-gray-700 space-y-6">
        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第1条（適用）</h2>
          <p>本規約は、ラクラク勤怠（以下「当サービス」）の利用に関する条件を定めるものです。ユーザーは本規約に同意の上、当サービスを利用するものとします。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第2条（利用登録）</h2>
          <p>当サービスはLINEアカウントを用いた認証を採用しています。LINEアカウントでログインした時点で、本規約に同意したものとみなします。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第3条（禁止事項）</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>虚偽の打刻・なりすまし行為</li>
            <li>他のユーザーの個人情報への不正アクセス</li>
            <li>当サービスのシステムへの不正な攻撃・妨害</li>
            <li>法令または公序良俗に違反する行為</li>
            <li>当サービスの運営を妨げる行為</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第4条（サービスの変更・停止）</h2>
          <p>当サービスは、事前の通知なくサービス内容の変更または停止をすることがあります。これによりユーザーに生じた損害について、当サービスは責任を負いません。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第5条（免責事項）</h2>
          <p>当サービスは、ユーザーが当サービスを利用したことによって生じたいかなる損害についても責任を負いません。ただし、当サービスの故意または重大な過失による場合はこの限りではありません。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第6条（料金）</h2>
          <p>有料プランの料金は別途定める料金プランに従います。無料トライアル期間中は無料でご利用いただけます。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第7条（退会・解約）</h2>
          <p>ユーザーはいつでも退会・解約の申請ができます。月単位の契約のため、翌月分から課金が停止します。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">第8条（準拠法）</h2>
          <p>本規約の解釈は日本法に準拠し、紛争が生じた場合は事業者所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。</p>
        </section>
      </div>
    </div>
  );
}
