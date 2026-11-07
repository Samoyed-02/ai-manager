"use client";

import { useState } from "react";
import { apiFetch, logout, splitErrors } from "@/lib/api";
import { cardClass, confirmDelete, dangerButton, ErrorText, formatDateTime, Page, subtleButton, useList } from "@/lib/ui";

type Session = { id: string; deviceName: string; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean };

export default function DevicesPage() {
    const sessions = useList<Session>("/auth/sessions");
    const [error, setError] = useState("");

    const run = async (action: () => Promise<unknown>) => {
        setError("");
        try {
            await action();
            sessions.reload();
        } catch (e) {
            setError(splitErrors(e, []).form);
        }
    };

    const revoke = (s: Session) =>
        run(() => confirmDelete(`/auth/sessions/${s.id}`, `"${s.deviceName}" 기기를 로그아웃할까요?`));

    const revokeOthers = () =>
        run(async () => {
            if (!window.confirm("이 기기를 뺀 모든 기기를 로그아웃할까요?")) return;
            await apiFetch("/auth/sessions", { method: "DELETE" });
        });

    const others = sessions.items?.filter((s) => !s.current) ?? [];

    return (
        <Page title="로그인한 기기">
            <ErrorText>{error || sessions.error}</ErrorText>
            <ul className="space-y-2">
                {sessions.items?.map((s) => (
                    <li key={s.id} className={`${cardClass} flex items-center justify-between gap-2`}>
                        <div className="min-w-0 text-sm">
                            <p className="font-bold">
                                {s.deviceName}
                                {s.current && <span className="ml-2 text-xs text-green-400">이 기기</span>}
                            </p>
                            <p className="text-xs text-gray-400">마지막 사용 {formatDateTime(s.lastUsedAt)}</p>
                            <p className="text-xs text-gray-500">로그인 {formatDateTime(s.createdAt)} · 만료 {formatDateTime(s.expiresAt)}</p>
                        </div>
                        {s.current ? (
                            <button onClick={() => window.confirm("이 기기에서 로그아웃할까요?") && logout()} className={subtleButton}>
                                로그아웃
                            </button>
                        ) : (
                            <button onClick={() => revoke(s)} className={dangerButton}>
                                끊기
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {others.length > 0 && (
                <button onClick={revokeOthers} className={`${dangerButton} mt-4`}>
                    다른 기기 모두 로그아웃
                </button>
            )}
        </Page>
    );
}
