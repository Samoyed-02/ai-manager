import Link from "next/link";

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

            <Link
                href="/voice"
                className="rounded-lg bg-green-600 py-3 text-center font-bold text-white"
            >
                🎙️ 통화 모드
            </Link>

            <Link
                href="/chat"
                className="rounded-lg bg-gray-700 py-3 text-center font-bold text-white"
            >
                💬 텍스트 모드
            </Link>

            <Link
                href="/docs"
                className="rounded-lg bg-gray-700 py-3 text-center font-bold text-white"
            >
                📄 문서함
            </Link>

            <div className="grid grid-cols-2 gap-2">
                {MORE.map(([href, label]) => (
                    <Link key={href} href={href} className="rounded-lg bg-gray-800 py-2.5 text-center text-sm text-white">
                        {label}
                    </Link>
                ))}
            </div>

            <Link
                href="/mic-test"
                className="rounded-lg bg-blue-600 py-3 text-center font-bold text-white"
            >
                마이크 / 잠금 테스트
            </Link>
        </main>
    );
}
