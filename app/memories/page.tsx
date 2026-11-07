"use client";

import { type FormEvent, useState } from "react";
import {
    cardClass,
    confirmDelete,
    dangerButton,
    ErrorText,
    Field,
    formatDateTime,
    inputClass,
    Page,
    primaryButton,
    sendJson,
    subtleButton,
    useForm,
    useList,
} from "@/lib/ui";
import { splitErrors } from "@/lib/api";

const CATEGORIES = { FACT: "사실", PREFERENCE: "선호", ROUTINE: "루틴", GOAL: "목표", PROGRESS: "진행 상황", OTHER: "기타" } as const;
type Category = keyof typeof CATEGORIES;
type Memory = { id: string; category: Category; content: string; createdAt: string; updatedAt: string };

const empty = { category: "FACT" as Category, content: "" };

export default function MemoriesPage() {
    const [filter, setFilter] = useState<Category | "">("");
    const memories = useList<Memory>(filter ? `/memories?category=${filter}` : "/memories");
    const form = useForm(["category", "content"]);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState(empty);
    const [error, setError] = useState("");

    const reset = () => {
        setEditing(null);
        setDraft(empty);
        form.reset();
    };

    const save = async (e: FormEvent) => {
        e.preventDefault();
        const ok = await form.submit(() =>
            editing ? sendJson(`/memories/${editing}`, "PUT", draft) : sendJson("/memories", "POST", draft),
        );
        if (ok) {
            reset();
            memories.reload();
        }
    };

    const remove = async (m: Memory) => {
        setError("");
        try {
            if (!(await confirmDelete(`/memories/${m.id}`, `이 기억을 삭제할까요?\n\n${m.content}`))) return;
            if (editing === m.id) reset();
            memories.reload();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    return (
        <Page title="기억 관리">
            <p className="mb-4 text-sm text-gray-600">AI가 대화에서 기억한 내용입니다. 모든 대화와 통화의 맥락에 들어갑니다.</p>

            <form onSubmit={save} className={`${cardClass} mb-6 space-y-3`}>
                <Field label="분류" error={form.fields.category}>
                    <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })} className={inputClass}>
                        {Object.entries(CATEGORIES).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="내용" error={form.fields.content}>
                    <textarea
                        required
                        maxLength={500}
                        rows={2}
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        className={inputClass}
                    />
                </Field>
                <ErrorText>{form.error}</ErrorText>
                <div className="flex gap-2">
                    <button type="submit" disabled={form.busy} className={primaryButton}>
                        {editing ? "수정 저장" : "기억 추가"}
                    </button>
                    {editing && (
                        <button type="button" onClick={reset} className={subtleButton}>
                            취소
                        </button>
                    )}
                </div>
            </form>

            <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
                분류
                <select value={filter} onChange={(e) => setFilter(e.target.value as Category | "")} className="rounded border border-gray-300 bg-white p-1.5">
                    <option value="">전체</option>
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                        <option key={k} value={k}>
                            {v}
                        </option>
                    ))}
                </select>
            </label>
            <ErrorText>{error || memories.error}</ErrorText>
            {memories.items?.length === 0 && <p className="text-sm text-gray-600">기억이 없습니다.</p>}
            <ul className="space-y-2">
                {memories.items?.map((m) => (
                    <li key={m.id} className={cardClass}>
                        <div className="mb-1 flex justify-between text-xs text-gray-600">
                            <span>{CATEGORIES[m.category]}</span>
                            <span>{formatDateTime(m.updatedAt)}</span>
                        </div>
                        <p className="mb-2 whitespace-pre-wrap text-sm">{m.content}</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setEditing(m.id);
                                    setDraft({ category: m.category, content: m.content });
                                    form.reset();
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className={subtleButton}
                            >
                                수정
                            </button>
                            <button onClick={() => remove(m)} className={dangerButton}>
                                삭제
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </Page>
    );
}
