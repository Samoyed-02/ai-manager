"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, splitErrors } from "@/lib/api";
import { cardClass, ErrorText, formatDateTime, Page, proseClass, subtleButton, useList } from "@/lib/ui";

type Notification = { id: string; title: string; body: string; createdAt: string; readAt: string | null };

export default function NotificationsPage() {
    const [unreadOnly, setUnreadOnly] = useState(false);
    const list = useList<Notification>(`/notifications?unread=${unreadOnly}`);
    const [error, setError] = useState("");

    const markRead = async (id: string) => {
        setError("");
        try {
            await apiFetch(`/notifications/${id}/read`, { method: "POST" });
            list.reload();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    return (
        <Page title="알림함">
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                읽지 않은 알림만
            </label>
            <ErrorText>{error || list.error}</ErrorText>
            {list.items?.length === 0 && <p className="text-sm text-gray-600">알림이 없습니다.</p>}
            <ul className="space-y-2">
                {list.items?.map((n) => (
                    <li key={n.id} className={`${cardClass} ${n.readAt ? "opacity-60" : ""}`}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-600">
                            <span>
                                {!n.readAt && <span className="mr-1 text-violet-700">●</span>}
                                {formatDateTime(n.createdAt)}
                            </span>
                            {!n.readAt && (
                                <button onClick={() => markRead(n.id)} className={subtleButton}>
                                    읽음
                                </button>
                            )}
                        </div>
                        <p className="mb-1 font-bold">{n.title}</p>
                        <div className={`${proseClass} text-sm`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.body}</ReactMarkdown>
                        </div>
                    </li>
                ))}
            </ul>
        </Page>
    );
}
