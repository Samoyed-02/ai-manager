import Link from "next/link";

export default function Home() {
    return (
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
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
                href="/mic-test"
                className="rounded-lg bg-blue-600 py-3 text-center font-bold text-white"
            >
                마이크 / 잠금 테스트
            </Link>
        </main>
    );
}