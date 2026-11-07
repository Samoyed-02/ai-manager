import Link from "next/link";

const MAIN = [
    ["/chat", "💬 텍스트 모드"],
    ["/docs", "📄 문서함"],
] as const;

const MORE = [
    ["/notifications", "🔔 알림함"],
    ["/routines", "⏰ 루틴"],
    ["/goals", "🎯 목표"],
    ["/activities", "📊 활동 기록"],
    ["/reviews", "📝 주간 회고"],
    ["/memories", "🧠 기억 관리"],
    ["/devices", "📱 로그인한 기기"],
] as const;

export default function Home() {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
            <h1 className="text-2xl font-bold">AI 매니저</h1>

            <Link href="/voice" className="rounded-2xl bg-violet-600 py-4 text-center font-bold text-white shadow-sm">
                🎙️ 수피와 통화하기
            </Link>

            {MAIN.map(([href, label]) => (
                <Link key={href} href={href} className="rounded-2xl bg-violet-100 py-3 text-center font-bold text-violet-900">
                    {label}
                </Link>
            ))}

            <div className="grid grid-cols-2 gap-2">
                {MORE.map(([href, label]) => (
                    <Link key={href} href={href} className="rounded-xl bg-gray-100 py-2.5 text-center text-sm font-medium text-gray-900">
                        {label}
                    </Link>
                ))}
            </div>

            <Link href="/mic-test" className="text-center text-sm text-gray-600 underline">
                마이크 / 잠금 테스트
            </Link>
        </main>
    );
}
