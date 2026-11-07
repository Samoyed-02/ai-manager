"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, splitErrors } from "@/lib/api";

export const inputClass = "w-full rounded-lg border border-gray-300 bg-white p-2 text-sm outline-none focus:border-violet-500";
export const primaryButton = "rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40";
export const subtleButton = "rounded-lg bg-violet-100 px-3 py-1.5 text-sm font-medium text-violet-900 disabled:opacity-40";
export const dangerButton = "rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-800 disabled:opacity-40";
export const cardClass = "rounded-xl border border-gray-200 bg-gray-50 p-3";
export const proseClass =
    "prose max-w-none prose-pre:overflow-x-auto prose-code:before:content-none prose-code:after:content-none";

export const formatDateTime = (iso: string) => new Date(iso).toLocaleString("ko-KR");

export const ACTIVITY_CATEGORIES = { STUDY: "공부", EXERCISE: "운동", WORK: "일", OTHER: "기타" } as const;
export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

export type TaskStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
export type Task = {
    id: string;
    instruction: string;
    status: TaskStatus;
    error: string | null;
    createdAt: string;
    documentId: string | null;
};
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
    PENDING: "⏳ 대기",
    RUNNING: "✍️ 작성 중",
    DONE: "✅ 완료",
    FAILED: "❌ 실패",
};

export function Page({ title, children }: { title: string; children: ReactNode }) {
    return (
        <main className="mx-auto w-full max-w-2xl p-4">
            <Link href="/" className="mb-2 inline-block text-sm text-gray-600">
                ← 홈
            </Link>
            <h1 className="mb-4 text-xl font-bold">{title}</h1>
            {children}
        </main>
    );
}

export function ErrorText({ children }: { children?: string }) {
    return (
        <p role="alert" className="text-sm text-red-600 empty:hidden">
            {children}
        </p>
    );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
    return (
        <label className="block text-sm">
            <span className="mb-1 block text-gray-600">{label}</span>
            {children}
            {error && <span className="mt-1 block text-red-600">{error}</span>}
        </label>
    );
}

/** GET path 목록. path가 바뀌면 다시 불러온다 */
export function useList<T>(path: string | null) {
    const [items, setItems] = useState<T[] | null>(null);
    const [error, setError] = useState("");
    const reload = useCallback(
        () =>
            path
                ? apiFetch(path)
                      .then((r) => r.json())
                      .then((v: T[]) => {
                          setItems(v);
                          setError("");
                      })
                      .catch((e) => setError(splitErrors(e, []).form))
                : Promise.resolve(),
        [path],
    );
    useEffect(() => {
        reload();
    }, [reload]);
    return { items, error, setError, reload };
}

/** 저장 요청을 보내고 400의 fields를 입력란별로 나눠 둔다 */
export function useForm(inputs: string[]) {
    const [busy, setBusy] = useState(false);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [error, setError] = useState("");
    const submit = async (action: () => Promise<unknown>) => {
        setBusy(true);
        setFields({});
        setError("");
        try {
            await action();
            return true;
        } catch (e) {
            const split = splitErrors(e, inputs);
            setFields(split.fields);
            setError(split.form);
            return false;
        } finally {
            setBusy(false);
        }
    };
    const reset = () => {
        setFields({});
        setError("");
    };
    return { busy, fields, error, submit, reset };
}

export async function sendJson(path: string, method: "POST" | "PUT", body: unknown) {
    return apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** 확인 창을 띄우고 삭제한다. 이미 지워져 404면 삭제된 것으로 본다. 취소하면 false */
export async function confirmDelete(path: string, question: string) {
    if (!window.confirm(question)) return false;
    try {
        await apiFetch(path, { method: "DELETE" });
    } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    return true;
}
