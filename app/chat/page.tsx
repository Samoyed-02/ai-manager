"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, apiFetch, splitErrors, streamChat } from "@/lib/api";
import { confirmDelete, proseClass, type Task, TASK_STATUS_LABEL, useForm } from "@/lib/ui";

type Status = "COMPLETE" | "TRUNCATED" | "REFUSED" | "INTERRUPTED";
type TaskRef = { taskId: string; instruction: string };
type Msg = { role: "user" | "assistant"; content: string; status?: Status; actions?: string[]; tasks?: TaskRef[] };
type Conv = { id: string; title: string | null; channel: "CHAT" | "VOICE"; updatedAt: string };

const STATUS_NOTE: Partial<Record<Status, string>> = {
    TRUNCATED: "⚠️ 답변이 길어 중간에 잘렸어요",
    REFUSED: "⚠️ 답변이 거절됐어요",
    INTERRUPTED: "⚠️ 답변이 중간에 끊겼어요",
};

function TaskCard({ taskId, instruction }: TaskRef) {
    const [task, setTask] = useState<Task | null>(null);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const t: Task = await (await apiFetch(`/tasks/${taskId}`)).json();
                if (stopped) return;
                setTask(t);
                if (t.status === "DONE" || t.status === "FAILED") return;
            } catch (e) {
                if (e instanceof ApiError && e.status === 404) return setGone(true);
            }
            if (!stopped) timer = setTimeout(poll, 5000);
        };
        poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [taskId]);

    return (
        <div className="not-prose my-2 rounded-lg border border-gray-200 p-3 text-sm">
            <div className="mb-1 text-xs text-gray-600">
                📄 문서 작업 · {gone ? "작업이 삭제됐어요" : task ? TASK_STATUS_LABEL[task.status] : "확인 중…"}
            </div>
            <p className="line-clamp-2">{instruction}</p>
            {task?.status === "DONE" &&
                (task.documentId ? (
                    <Link href="/docs" className="mt-1 inline-block text-violet-700">
                        문서함에서 보기 →
                    </Link>
                ) : (
                    <p className="mt-1 text-gray-600">문서 삭제됨</p>
                ))}
            {task?.status === "FAILED" && task.error && <p className="mt-1 text-red-600">{task.error}</p>}
        </div>
    );
}

export default function ChatPage() {
    const [convs, setConvs] = useState<Conv[]>([]);
    const [convId, setConvId] = useState<string | null>(null);
    const [msgs, setMsgs] = useState<Msg[]>([]);
    const [input, setInput] = useState("");
    const [error, setError] = useState("");
    const form = useForm(["message"]);
    const busy = form.busy;
    const bottom = useRef<HTMLDivElement>(null);

    const loadConvs = () =>
        apiFetch("/conversations")
            .then((r) => r.json())
            .then(setConvs)
            .catch((e) => setError(splitErrors(e, []).form));

    useEffect(() => {
        loadConvs();
    }, []);

    useEffect(() => {
        bottom.current?.scrollIntoView({ behavior: "smooth" });
    }, [msgs]);

    const newConv = () => {
        setConvId(null);
        setMsgs([]);
        setError("");
        form.reset();
    };

    const openConv = async (id: string) => {
        if (!id) return newConv();
        setConvId(id);
        setError("");
        form.reset();
        try {
            const res = await apiFetch(`/conversations/${id}/messages`);
            setMsgs(await res.json());
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    const deleteConv = async () => {
        if (!convId) return;
        try {
            if (!(await confirmDelete(`/conversations/${convId}`, "이 대화를 삭제할까요? 되돌릴 수 없습니다."))) return;
            newConv();
            loadConvs();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    const patchLast = (f: (m: Msg) => Msg) => setMsgs((p) => [...p.slice(0, -1), f(p[p.length - 1])]);

    const send = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setError("");
        setMsgs((p) => [...p, { role: "user", content: text }, { role: "assistant", content: "" }]);

        let received = "";
        const ok = await form.submit(async () => {
            let finished = false;
            let failure: { code: string; message: string } | null = null;
            await streamChat({ conversationId: convId, message: text }, (event, data) => {
                if (event === "meta") setConvId(data.conversationId);
                else if (event === "delta") {
                    received += data.text;
                    patchLast((m) => ({ ...m, content: m.content + data.text }));
                } else if (event === "action") patchLast((m) => ({ ...m, actions: [...(m.actions ?? []), data.summary] }));
                else if (event === "task") patchLast((m) => ({ ...m, tasks: [...(m.tasks ?? []), data] }));
                else if (event === "done") {
                    finished = true;
                    patchLast((m) => ({ ...m, status: data.status }));
                } else if (event === "error") failure = data;
            });
            if (failure) {
                const { code, message } = failure;
                // 대화가 지워져 답변이 저장되지 않았다. 다음 메시지는 새 대화로 보낸다
                if (code === "CONVERSATION_DELETED") setConvId(null);
                throw new Error(message);
            }
            if (!finished) throw new Error("연결이 끊겨 답변을 끝까지 받지 못했어요.");
        });

        if (ok) setInput("");
        // 실패하면 입력은 그대로 둔다. 답이 비었으면 서버도 질문을 저장하지 않으므로 화면에서도 뺀다
        else if (!received) setMsgs((p) => p.slice(0, -2));
        else patchLast((m) => ({ ...m, status: m.status ?? "INTERRUPTED" }));
        loadConvs();
    };

    return (
        <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
            <header className="flex items-center gap-2 border-b border-gray-200 p-3">
                <Link href="/" className="text-sm text-gray-600">
                    ← 홈
                </Link>
                <select
                    value={convId ?? ""}
                    onChange={(e) => openConv(e.target.value)}
                    disabled={busy}
                    aria-label="대화 선택"
                    className="min-w-0 flex-1 rounded border border-gray-300 bg-white p-2 text-sm"
                >
                    <option value="">새 대화</option>
                    {convs.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.channel === "VOICE" ? "🎙️ " : ""}
                            {c.title ?? "(제목 없음)"}
                        </option>
                    ))}
                </select>
                {convId && (
                    <button onClick={deleteConv} disabled={busy} className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800 disabled:opacity-40">
                        삭제
                    </button>
                )}
                <button onClick={newConv} disabled={busy} className="rounded-lg bg-violet-100 px-3 py-2 text-sm font-medium text-violet-900 disabled:opacity-40">
                    + 새 대화
                </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {msgs.map((m, i) =>
                    m.role === "user" ? (
                        <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-violet-600 px-4 py-2 text-white">
                            {m.content}
                        </div>
                    ) : (
                        <div key={i}>
                            <div className={proseClass}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                            </div>
                            {m.tasks?.map((t) => <TaskCard key={t.taskId} {...t} />)}
                            {m.actions && m.actions.length > 0 && (
                                <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                                    {m.actions.map((a, j) => (
                                        <li key={j}>🛠️ {a}</li>
                                    ))}
                                </ul>
                            )}
                            {m.status && STATUS_NOTE[m.status] && <p className="mt-1 text-xs text-amber-700">{STATUS_NOTE[m.status]}</p>}
                        </div>
                    ),
                )}
                <p role="alert" className="text-sm text-red-600 empty:hidden">
                    {error || form.error}
                </p>
                <div ref={bottom} />
            </div>

            <div className="border-t border-gray-200 p-3">
                <div className="flex gap-2">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                send();
                            }
                        }}
                        readOnly={busy}
                        rows={1}
                        maxLength={20000}
                        aria-label="메시지"
                        aria-invalid={!!form.fields.message}
                        placeholder="메시지 입력 (Shift+Enter 줄바꿈)"
                        className="flex-1 resize-none rounded-xl border border-gray-300 bg-white p-3 text-sm outline-none read-only:opacity-60"
                    />
                    <button
                        onClick={send}
                        disabled={busy}
                        className="rounded-xl bg-violet-600 px-4 font-bold text-white disabled:opacity-40"
                    >
                        {busy ? "…" : "전송"}
                    </button>
                </div>
                {form.fields.message && <p className="mt-1 text-sm text-red-600">{form.fields.message}</p>}
            </div>
        </main>
    );
}
