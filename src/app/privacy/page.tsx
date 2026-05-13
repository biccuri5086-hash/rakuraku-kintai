import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-[#06C755] mb-4 inline-block">← ホームに戻る</Link>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">プライバシーポリシー</h1>
      <p className="text-sm text-gray-400 mb-6">最終更新日：2026年5月13日</p>

      <div className="prose prose-sm text-gray-700 space-y-6">
        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">1. 取得する個人情報</h2>
          <p>当サービス「ラクラク勤怠」は、以下の個人情報を取得します。</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>LINEアカウント情報（ユーザーID、表示名、プロフィール画像）</li>
            <li>携帯電話番号（本人確認のため）</li>
            <li>打刻情報（出勤・退勤の日時）</li>
            <li>位置情報（打刻時のGPS座標。取得に同意した場合のみ）</li>
            <li>コンディション報告（任意入力のスコアとコメント）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">2. 利用目的</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>勤怠管理サービスの提供</li>
            <li>派遣会社の担当者への勤怠情報の提供</li>
            <li>コンディション報告を通じた労働環境の改善支援</li>
            <li>サービスの改善・開発</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">3. 第三者提供</h2>
          <p>取得した個人情報は、以下の場合を除き第三者に提供しません。</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>ご本人の同意がある場合</li>
            <li>法令に基づく場合</li>
            <li>利用者が所属する派遣会社の管理者への開示（サービスの性質上、業務委託関係にあります）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">4. 位置情報の取り扱い</h2>
          <p>位置情報（GPS）は打刻時に取得します。取得はスマートフォンのブラウザが許可した場合のみ行われ、打刻の正確性確認のために利用します。位置情報の取得を拒否しても、打刻機能は正常に利用できます。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">5. データの保管・管理</h2>
          <p>個人情報はAmazon Web Services（東京リージョン）上のデータベースに保存され、暗号化通信（HTTPS）により保護されます。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">6. 個人情報の開示・削除</h2>
          <p>ご本人から個人情報の開示・訂正・削除のご要望があった場合は、お問い合わせ窓口にてご対応いたします。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-2">7. お問い合わせ</h2>
          <p>プライバシーポリシーに関するお問い合わせは、下記までご連絡ください。</p>
          <p className="mt-2 text-gray-500">事業者名：（事業者名を記入してください）<br />メール：（メールアドレスを記入してください）</p>
        </section>
      </div>
    </div>
  );
}
