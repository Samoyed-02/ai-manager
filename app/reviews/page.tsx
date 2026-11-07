"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, splitErrors } from "@/lib/api";
import { ACTIVITY_CATEGORIES, type ActivityCategory, cardClass, ErrorText, Page, proseClass, useList } from "@/lib/ui";

type Summary = { id: string; periodStart: string; periodEnd: string; createdAt: string };
// 서버 ReviewService.toJson 형식
type Stats = {
    categories?: { category: ActivityCategory; minutes: number; previous_minutes: number; count: number }[];
    goals?: { title: string; minutes: number; weekly_target_minutes: number | null }[];
    days_without_logs?: number;
    tasks_done?: number;
};
type Review = Summary & { stats: Stats; content: string };

export default function ReviewsPage() {
    const list = useList<Summary>("/reviews");
    const [review, setReview] = useState<Review | null>(null);
    const [error, setError] = useState("");

    const open = async (id: string) => {
        setError("");
        try {
            setReview(await (await apiFetch(`/reviews/${id}`)).json());
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    if (review) {
        const s = review.stats;
        return (
            <Page title={`주간 회고 ${review.periodStart} ~ ${review.periodEnd}`}>
                <button onClick={() => setReview(null)} className="mb-4 text-sm text-gray-400">
                    ← 목록
                </button>
                <div className={`${cardClass} mb-4 space-y-1 text-sm`}>
                    {s.categories?.map((c) => (
                        <p key={c.category}>
                            {ACTIVITY_CATEGORIES[c.category] ?? c.category}: {c.minutes}분 ({c.count}건, 지난주 {c.previous_minutes}분)
                        </p>
                    ))}
                    {s.goals?.map((g) => (
                        <p key={g.title}>
                            🎯 {g.title}: {g.minutes}분{g.weekly_target_minutes != null && ` / 목표 ${g.weekly_target_minutes}분`}
                        </p>
                    ))}
                    {s.days_without_logs != null && <p>기록 없는 날: {s.days_without_logs}일</p>}
                    {s.tasks_done != null && <p>완료한 문서 작업: {s.tasks_done}건</p>}
                </div>
                <article className={proseClass}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{review.content}</ReactMarkdown>
                </article>
            </Page>
        );
    }

    return (
        <Page title="주간 회고">
            <ErrorText>{error || list.error}</ErrorText>
            {list.items?.length === 0 && <p className="text-sm text-gray-500">아직 회고가 없습니다. 루틴에서 회고 루틴을 만들면 쌓입니다.</p>}
            <ul className="space-y-2">
                {list.items?.map((r) => (
                    <li key={r.id}>
                        <button onClick={() => open(r.id)} className={`${cardClass} w-full text-left text-sm`}>
                            {r.periodStart} ~ {r.periodEnd}
                        </button>
                    </li>
                ))}
            </ul>
        </Page>
    );
}
