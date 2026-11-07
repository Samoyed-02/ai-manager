"use client";

import { type FormEvent, useState } from "react";
import {
    ACTIVITY_CATEGORIES,
    type ActivityCategory,
    cardClass,
    ErrorText,
    Field,
    inputClass,
    Page,
    primaryButton,
    sendJson,
    subtleButton,
    useForm,
    useList,
} from "@/lib/ui";

const STATUSES = { ACTIVE: "진행 중", DONE: "달성", DROPPED: "중단" } as const;
type Status = keyof typeof STATUSES;
type Goal = {
    id: string;
    title: string;
    description: string | null;
    category: ActivityCategory;
    status: Status;
    weeklyTargetMinutes: number | null;
    dueDate: string | null;
    progress: string;
};
type Draft = { title: string; category: ActivityCategory; description: string; weeklyTargetMinutes: string; dueDate: string; status: Status };
const empty: Draft = { title: "", category: "STUDY", description: "", weeklyTargetMinutes: "", dueDate: "", status: "ACTIVE" };

export default function GoalsPage() {
    const [filter, setFilter] = useState<Status | "">("ACTIVE");
    const goals = useList<Goal>(filter ? `/goals?status=${filter}` : "/goals");
    const form = useForm(["title", "category", "description", "weeklyTargetMinutes", "dueDate", "status"]);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft>(empty);

    const reset = () => {
        setEditing(null);
        setDraft(empty);
        form.reset();
    };

    const save = async (e: FormEvent) => {
        e.preventDefault();
        const body = {
            ...draft,
            weeklyTargetMinutes: draft.weeklyTargetMinutes ? Number(draft.weeklyTargetMinutes) : null,
            dueDate: draft.dueDate || null,
            status: editing ? draft.status : undefined,
        };
        const ok = await form.submit(() => (editing ? sendJson(`/goals/${editing}`, "PUT", body) : sendJson("/goals", "POST", body)));
        if (ok) {
            reset();
            goals.reload();
        }
    };

    const setStatus = (g: Goal, status: Status) => form.submit(() => sendJson(`/goals/${g.id}`, "PUT", { status })).then(() => goals.reload());

    // 서버는 null을 "바꾸지 않음"으로 받아 수정 때 비워도 기존 값이 남는다
    const keepHint = editing ? " (비우면 기존 값 유지)" : "";

    return (
        <Page title="목표">
            <form onSubmit={save} className={`${cardClass} mb-6 space-y-3`}>
                <Field label="목표" error={form.fields.title}>
                    <input required maxLength={100} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass} />
                </Field>
                <Field label="분류" error={form.fields.category}>
                    <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ActivityCategory })} className={inputClass}>
                        {Object.entries(ACTIVITY_CATEGORIES).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="설명 (선택)" error={form.fields.description}>
                    <textarea maxLength={1000} rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} />
                </Field>
                <Field label={`주간 목표 시간(분, 선택)${keepHint}`} error={form.fields.weeklyTargetMinutes}>
                    <input type="number" min={1} max={10080} value={draft.weeklyTargetMinutes} onChange={(e) => setDraft({ ...draft, weeklyTargetMinutes: e.target.value })} className={inputClass} />
                </Field>
                <Field label={`마감일 (선택)${keepHint}`} error={form.fields.dueDate}>
                    <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} className={inputClass} />
                </Field>
                {editing && (
                    <Field label="상태" error={form.fields.status}>
                        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })} className={inputClass}>
                            {Object.entries(STATUSES).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}
                <ErrorText>{form.error}</ErrorText>
                <div className="flex gap-2">
                    <button type="submit" disabled={form.busy} className={primaryButton}>
                        {editing ? "수정 저장" : "목표 추가"}
                    </button>
                    {editing && (
                        <button type="button" onClick={reset} className={subtleButton}>
                            취소
                        </button>
                    )}
                </div>
            </form>

            <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
                상태
                <select value={filter} onChange={(e) => setFilter(e.target.value as Status | "")} className="rounded border border-gray-300 bg-white p-1.5">
                    <option value="">전체</option>
                    {Object.entries(STATUSES).map(([k, v]) => (
                        <option key={k} value={k}>
                            {v}
                        </option>
                    ))}
                </select>
            </label>
            <ErrorText>{goals.error}</ErrorText>
            {goals.items?.length === 0 && <p className="text-sm text-gray-600">목표가 없습니다.</p>}
            <ul className="space-y-2">
                {goals.items?.map((g) => (
                    <li key={g.id} className={cardClass}>
                        <div className="mb-1 text-xs text-gray-600">
                            {ACTIVITY_CATEGORIES[g.category]} · {STATUSES[g.status]}
                        </div>
                        <p className="text-sm font-bold">{g.progress}</p>
                        {g.description && <p className="mt-1 line-clamp-3 text-sm text-gray-700">{g.description}</p>}
                        <div className="mt-2 flex flex-wrap gap-2">
                            {g.status === "ACTIVE" ? (
                                <>
                                    <button onClick={() => window.confirm(`"${g.title}" 목표를 달성으로 바꿀까요?`) && setStatus(g, "DONE")} className={subtleButton}>
                                        달성
                                    </button>
                                    <button onClick={() => window.confirm(`"${g.title}" 목표를 중단할까요?`) && setStatus(g, "DROPPED")} className={subtleButton}>
                                        중단
                                    </button>
                                </>
                            ) : (
                                <button onClick={() => setStatus(g, "ACTIVE")} className={subtleButton}>
                                    다시 진행
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setEditing(g.id);
                                    setDraft({
                                        title: g.title,
                                        category: g.category,
                                        description: g.description ?? "",
                                        weeklyTargetMinutes: g.weeklyTargetMinutes?.toString() ?? "",
                                        dueDate: g.dueDate ?? "",
                                        status: g.status,
                                    });
                                    form.reset();
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className={subtleButton}
                            >
                                수정
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </Page>
    );
}
