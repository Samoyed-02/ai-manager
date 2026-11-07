"use client";

import { useState } from "react";
import { splitErrors } from "@/lib/api";
import { ACTIVITY_CATEGORIES, type ActivityCategory, cardClass, confirmDelete, ErrorText, Page, useList } from "@/lib/ui";

type Activity = { id: string; category: ActivityCategory; description: string; minutes: number | null; date: string };

export default function ActivitiesPage() {
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const invalid = !!from && !!to && from > to;
    const query = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v)).toString();
    const list = useList<Activity>(invalid ? null : `/activities${query ? `?${query}` : ""}`);
    const [error, setError] = useState("");

    const remove = async (a: Activity) => {
        setError("");
        try {
            if (await confirmDelete(`/activities/${a.id}`, `이 활동 기록을 삭제할까요?\n\n${a.description}`)) list.reload();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    const total = list.items?.reduce((sum, a) => sum + (a.minutes ?? 0), 0) ?? 0;

    return (
        <Page title="활동 기록">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-400">
                <label className="flex items-center gap-1">
                    시작 <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="rounded bg-gray-900 p-1.5" />
                </label>
                <label className="flex items-center gap-1">
                    끝 <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="rounded bg-gray-900 p-1.5" />
                </label>
                {!from && !to && <span>최근 7일</span>}
            </div>
            <ErrorText>{invalid ? "시작일이 끝일보다 늦습니다." : error || list.error}</ErrorText>
            {list.items && list.items.length > 0 && (
                <p className="mb-2 text-sm text-gray-400">
                    {list.items.length}건 · 합계 {Math.floor(total / 60)}시간 {total % 60}분
                </p>
            )}
            {list.items?.length === 0 && <p className="text-sm text-gray-500">기록이 없습니다.</p>}
            <ul className="space-y-2">
                {list.items?.map((a) => (
                    <li key={a.id} className={`${cardClass} flex items-start justify-between gap-2`}>
                        <div className="min-w-0 text-sm">
                            <p className="text-xs text-gray-400">
                                {a.date} · {ACTIVITY_CATEGORIES[a.category]}
                                {a.minutes != null && ` · ${a.minutes}분`}
                            </p>
                            <p>{a.description}</p>
                        </div>
                        <button onClick={() => remove(a)} aria-label="활동 삭제" className="px-1 text-sm text-gray-500">
                            ✕
                        </button>
                    </li>
                ))}
            </ul>
        </Page>
    );
}
