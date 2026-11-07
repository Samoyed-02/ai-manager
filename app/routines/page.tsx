"use client";

import { type FormEvent, useState } from "react";
import { splitErrors } from "@/lib/api";
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

const KINDS = {
    REMINDER: { label: "알림", hint: "보낼 문구" },
    BRIEFING: { label: "브리핑", hint: "브리핑에 담을 내용 지시" },
    REVIEW: { label: "회고", hint: "회고에 담을 내용 지시" },
} as const;
type Kind = keyof typeof KINDS;
const DAYS = [
    ["MON", "월"],
    ["TUE", "화"],
    ["WED", "수"],
    ["THU", "목"],
    ["FRI", "금"],
    ["SAT", "토"],
    ["SUN", "일"],
] as const;

type Routine = {
    id: string;
    title: string;
    kind: Kind;
    message: string;
    days: string[];
    time: string;
    schedule: string;
    enabled: boolean;
    nextRunAt: string;
    lastRunAt: string | null;
};
type Draft = { title: string; kind: Kind; message: string; time: string; days: string[]; enabled: boolean };
const empty: Draft = { title: "", kind: "REMINDER", message: "", time: "08:00", days: [], enabled: true };

export default function RoutinesPage() {
    const routines = useList<Routine>("/routines");
    const form = useForm(["title", "kind", "message", "time", "days", "enabled"]);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft>(empty);
    const [error, setError] = useState("");

    const reset = () => {
        setEditing(null);
        setDraft(empty);
        form.reset();
    };

    const save = async (e: FormEvent) => {
        e.preventDefault();
        const ok = await form.submit(() =>
            editing ? sendJson(`/routines/${editing}`, "PUT", draft) : sendJson("/routines", "POST", draft),
        );
        if (ok) {
            reset();
            routines.reload();
        }
    };

    const run = async (action: () => Promise<unknown>) => {
        setError("");
        try {
            await action();
            routines.reload();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    const toggleDay = (code: string) =>
        setDraft({ ...draft, days: draft.days.includes(code) ? draft.days.filter((d) => d !== code) : [...draft.days, code] });

    return (
        <Page title="루틴">
            <form onSubmit={save} className={`${cardClass} mb-6 space-y-3`}>
                <Field label="이름" error={form.fields.title}>
                    <input required maxLength={100} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass} />
                </Field>
                <Field label="종류" error={form.fields.kind}>
                    <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })} className={inputClass}>
                        {Object.entries(KINDS).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v.label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label={KINDS[draft.kind].hint} error={form.fields.message}>
                    <textarea required maxLength={2000} rows={2} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} className={inputClass} />
                </Field>
                <Field label="시각 (한국 시간)" error={form.fields.time}>
                    <input type="time" required value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className={inputClass} />
                </Field>
                <fieldset className="text-sm">
                    <legend className="mb-1 text-gray-400">요일 (선택하지 않으면 매일)</legend>
                    <div className="flex flex-wrap gap-3">
                        {DAYS.map(([code, label]) => (
                            <label key={code} className="flex items-center gap-1">
                                <input type="checkbox" checked={draft.days.includes(code)} onChange={() => toggleDay(code)} />
                                {label}
                            </label>
                        ))}
                    </div>
                    {form.fields.days && <span className="mt-1 block text-red-400">{form.fields.days}</span>}
                </fieldset>
                {editing && (
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                        켜기
                    </label>
                )}
                <ErrorText>{form.error}</ErrorText>
                <div className="flex gap-2">
                    <button type="submit" disabled={form.busy} className={primaryButton}>
                        {editing ? "수정 저장" : "루틴 추가"}
                    </button>
                    {editing && (
                        <button type="button" onClick={reset} className={subtleButton}>
                            취소
                        </button>
                    )}
                </div>
            </form>

            <ErrorText>{error || routines.error}</ErrorText>
            {routines.items?.length === 0 && <p className="text-sm text-gray-500">루틴이 없습니다.</p>}
            <ul className="space-y-2">
                {routines.items?.map((r) => (
                    <li key={r.id} className={`${cardClass} ${r.enabled ? "" : "opacity-60"}`}>
                        <div className="mb-1 flex justify-between gap-2 text-xs text-gray-400">
                            <span>
                                {KINDS[r.kind].label} · {r.schedule}
                                {!r.enabled && " · 꺼짐"}
                            </span>
                            {r.enabled && <span>다음 {formatDateTime(r.nextRunAt)}</span>}
                        </div>
                        <p className="font-bold">{r.title}</p>
                        <p className="mb-2 line-clamp-2 text-sm text-gray-300">{r.message}</p>
                        <div className="flex gap-2">
                            <button onClick={() => run(() => sendJson(`/routines/${r.id}`, "PUT", { enabled: !r.enabled }))} className={subtleButton}>
                                {r.enabled ? "끄기" : "켜기"}
                            </button>
                            <button
                                onClick={() => {
                                    setEditing(r.id);
                                    setDraft({ title: r.title, kind: r.kind, message: r.message, time: r.time, days: r.days, enabled: r.enabled });
                                    form.reset();
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className={subtleButton}
                            >
                                수정
                            </button>
                            <button
                                onClick={() =>
                                    run(async () => {
                                        if ((await confirmDelete(`/routines/${r.id}`, `"${r.title}" 루틴을 삭제할까요?`)) && editing === r.id) reset();
                                    })
                                }
                                className={dangerButton}
                            >
                                삭제
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </Page>
    );
}
