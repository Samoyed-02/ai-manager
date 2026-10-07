"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, streamChat } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string | null; updatedAt: string };

export default function ChatPage() {
    const [convs, setConvs] = useState<Conv[]>([]);
    const [convId, setConvId] = useState<string | null>(null);
    const [msgs, setMsgs] = useState<Msg[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const bottom = useRef<HTMLDivElement>(null);

    const loadConvs = () =>
        apiFetch("/conversations")
            .then((r) => r.json())
            .then(setConvs)
            .catch((e) => setError(e.message));

    useEffect(() => {
        loadConvs();
    }, []);

    useEffect(() => {
        bottom.current?.scrollIntoView({ behavior: "smooth" });
    }, [msgs]);

    const openConv = async (id: string) => {
        if (!id) return newConv();
        setConvId(id);
        setError("");
        try {
            const res = await apiFetch(`/conversations/${id}/messages`);
            setMsgs(await res.json());
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const newConv = () => {
        setConvId(null);
        setMsgs([]);
        setError("");
    };

    const send = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setInput("");
        setError("");
        setBusy(true);
        setMsgs((p) => [...p, { role: "user", content: text }, { role: "assistant", content: "" }]);

        try {
            await streamChat({ conversationId: convId, message: text }, (event, data) => {
                if (event === "meta") setConvId(data.conversationId);
                else if (event === "delta")
                    setMsgs((p) => {
                        const copy = [...p];
                        const last = copy[copy.length - 1];
                        copy[copy.length - 1] = { ...last, content: last.content + data.text };
                        return copy;
                    });
                else if (event === "error") setError(data.message);
            });
            loadConvs();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="mx-auto flex h-dvh max-w-2xl flex-col">
            <header className="flex items-center gap-2 border-b border-gray-800 p-3">
                <Link href="/" className="text-sm text-gray-400">
                    ← 홈
                </Link>
                <select
                    value={convId ?? ""}
                    onChange={(e) => openConv(e.target.value)}
                    className="min-w-0 flex-1 rounded bg-gray-900 p-2 text-sm"
                >
                    <option value="">새 대화</option>
                    {convs.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.title ?? "(제목 없음)"}
                        </option>
                    ))}
                </select>
                <button onClick={newConv} className="rounded bg-gray-800 px-3 py-2 text-sm">
                    + 새 대화
                </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {msgs.map((m, i) =>
                    m.role === "user" ? (
                        <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2 text-white">
                            {m.content}
                        </div>
                    ) : (
                        <div key={i} className="prose prose-invert max-w-none prose-pre:overflow-x-auto">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                        </div>
                    ),
                )}
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div ref={bottom} />
            </div>

            <div className="flex gap-2 border-t border-gray-800 p-3">
        <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                }
            }}
            rows={1}
            placeholder="메시지 입력 (Shift+Enter 줄바꿈)"
            className="flex-1 resize-none rounded-xl bg-gray-900 p-3 text-sm outline-none"
        />
                <button
                    onClick={send}
                    disabled={busy}
                    className="rounded-xl bg-blue-600 px-4 font-bold text-white disabled:opacity-40"
                >
                    {busy ? "…" : "전송"}
                </button>
            </div>
        </main>
    );
}