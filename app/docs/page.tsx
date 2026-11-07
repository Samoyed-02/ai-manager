"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, splitErrors } from "@/lib/api";
import {
    cardClass,
    confirmDelete,
    dangerButton,
    ErrorText,
    formatDateTime,
    Page,
    proseClass,
    subtleButton,
    type Task,
    TASK_STATUS_LABEL,
    useList,
} from "@/lib/ui";

type DocSummary = { id: string; taskId: string | null; title: string; createdAt: string };
type Doc = DocSummary & { content: string };

export default function DocsPage() {
    const tasks = useList<Task>("/tasks");
    const docs = useList<DocSummary>("/documents");
    const [doc, setDoc] = useState<Doc | null>(null);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const { reload } = tasks;

    useEffect(() => {
        const timer = setInterval(reload, 5000);
        return () => clearInterval(timer);
    }, [reload]);

    const run = async (action: () => Promise<unknown>) => {
        setError("");
        try {
            await action();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    const openDoc = (id: string) =>
        run(async () => {
            setDoc(await (await apiFetch(`/documents/${id}`)).json());
            setCopied(false);
        });

    const deleteDoc = (id: string) =>
        run(async () => {
            if (!(await confirmDelete(`/documents/${id}`, "이 문서를 삭제할까요? 작업 기록은 남습니다."))) return;
            setDoc(null);
            tasks.reload();
            docs.reload();
        });

    const deleteTask = (id: string) =>
        run(async () => {
            if (!(await confirmDelete(`/tasks/${id}`, "이 작업을 삭제할까요? 만들어진 문서는 남습니다."))) return;
            tasks.reload();
            docs.reload();
        });

    const copy = async () => {
        if (!doc) return;
        await navigator.clipboard.writeText(doc.content);
        setCopied(true);
    };

    if (doc) {
        return (
            <main className="mx-auto w-full max-w-2xl p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                    <button onClick={() => setDoc(null)} className="text-sm text-gray-400">
                        ← 목록
                    </button>
                    <div className="flex gap-2">
                        <button onClick={copy} className={subtleButton}>
                            {copied ? "복사됨 ✓" : "📋 마크다운 복사"}
                        </button>
                        <button onClick={() => deleteDoc(doc.id)} className={dangerButton}>
                            삭제
                        </button>
                    </div>
                </div>
                <ErrorText>{error}</ErrorText>
                <article className={proseClass}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
                </article>
            </main>
        );
    }

    // 작업이 지워졌거나 최근 20개 밖이라 작업 목록에서 열 수 없는 문서
    const otherDocs = (docs.items ?? []).filter((d) => !tasks.items?.some((t) => t.documentId === d.id));

    return (
        <Page title="문서함">
            <ErrorText>{error || tasks.error || docs.error}</ErrorText>
            {tasks.items?.length === 0 && <p className="text-sm text-gray-500">맡긴 작업이 없습니다.</p>}

            <ul className="space-y-2">
                {tasks.items?.map((t) => (
                    <li key={t.id} className={`${cardClass} flex items-start gap-2`}>
                        <button
                            disabled={!t.documentId}
                            onClick={() => t.documentId && openDoc(t.documentId)}
                            className="min-w-0 flex-1 text-left disabled:cursor-default"
                        >
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-400">
                                <span>{TASK_STATUS_LABEL[t.status]}</span>
                                <span>{formatDateTime(t.createdAt)}</span>
                            </div>
                            <p className="line-clamp-2 text-sm">{t.instruction}</p>
                            {t.status === "DONE" && !t.documentId && <p className="mt-1 text-xs text-gray-500">문서 삭제됨</p>}
                            {t.status === "FAILED" && t.error && (
                                <p className="mt-1 line-clamp-2 text-xs text-red-400">{t.error}</p>
                            )}
                        </button>
                        <button onClick={() => deleteTask(t.id)} aria-label="작업 삭제" className="px-1 text-sm text-gray-500">
                            ✕
                        </button>
                    </li>
                ))}
            </ul>

            {otherDocs.length > 0 && (
                <>
                    <h2 className="mt-6 mb-2 text-sm font-bold text-gray-400">그 밖의 문서</h2>
                    <ul className="space-y-2">
                        {otherDocs.map((d) => (
                            <li key={d.id}>
                                <button onClick={() => openDoc(d.id)} className={`${cardClass} w-full text-left`}>
                                    <div className="mb-1 text-xs text-gray-400">{formatDateTime(d.createdAt)}</div>
                                    <p className="line-clamp-2 text-sm">{d.title}</p>
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Page>
    );
}
