"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch } from "@/lib/api";

type TaskStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
type Task = {
    id: string;
    instruction: string;
    status: TaskStatus;
    error: string | null;
    createdAt: string;
    documentId: string | null;
};
type Doc = { id: string; title: string; content: string; createdAt: string };

const STATUS_LABEL: Record<TaskStatus, string> = {
    PENDING: "⏳ 대기",
    RUNNING: "✍️ 작성 중",
    DONE: "✅ 완료",
    FAILED: "❌ 실패",
};

export default function DocsPage() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [doc, setDoc] = useState<Doc | null>(null);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);

    const loadTasks = () =>
        apiFetch("/tasks")
            .then((r) => r.json())
            .then(setTasks)
            .catch((e) => setError(e.message));

    useEffect(() => {
        loadTasks();
        const timer = setInterval(loadTasks, 5000);
        return () => clearInterval(timer);
    }, []);

    const openDoc = async (id: string) => {
        try {
            const res = await apiFetch(`/documents/${id}`);
            setDoc(await res.json());
            setCopied(false);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const copy = async () => {
        if (!doc) return;
        await navigator.clipboard.writeText(doc.content);
        setCopied(true);
    };

    if (doc) {
        return (
            <main className="mx-auto max-w-2xl p-4">
                <div className="mb-4 flex items-center justify-between">
                    <button onClick={() => setDoc(null)} className="text-sm text-gray-400">
                        ← 목록
                    </button>
                    <button onClick={copy} className="rounded bg-gray-800 px-3 py-1.5 text-sm">
                        {copied ? "복사됨 ✓" : "📋 마크다운 복사"}
                    </button>
                </div>
                <article className="prose prose-invert max-w-none prose-pre:overflow-x-auto prose-code:before:content-none prose-code:after:content-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
                </article>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-2xl p-4">
            <Link href="/" className="mb-2 inline-block text-sm text-gray-400">
                ← 홈
            </Link>
            <h1 className="mb-4 text-xl font-bold">문서함</h1>
            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
            {tasks.length === 0 && <p className="text-sm text-gray-500">맡긴 작업이 없습니다.</p>}

            <ul className="space-y-2">
                {tasks.map((t) => {
                    const clickable = t.status === "DONE" && t.documentId;
                    return (
                        <li key={t.id}>
                            <button
                                disabled={!clickable}
                                onClick={() => clickable && openDoc(t.documentId!)}
                                className="w-full rounded-lg bg-gray-900 p-3 text-left disabled:cursor-default"
                            >
                                <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                                    <span>{STATUS_LABEL[t.status]}</span>
                                    <span>{new Date(t.createdAt).toLocaleString("ko-KR")}</span>
                                </div>
                                <p className="line-clamp-2 text-sm">{t.instruction}</p>
                                {t.status === "FAILED" && t.error && (
                                    <p className="mt-1 line-clamp-2 text-xs text-red-400">{t.error}</p>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </main>
    );
}