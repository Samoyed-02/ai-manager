import Link from "next/link";

export default function Home() {
  return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold">AI 매니저</h1>
        <Link
            href="/mic-test"
            className="rounded-lg bg-blue-600 py-3 text-center font-bold text-white"
        >
          마이크 / 잠금 테스트
        </Link>
      </main>
  );
}