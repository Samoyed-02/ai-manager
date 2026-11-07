"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, login } from "@/lib/api";

const inputClass = "w-full rounded-lg bg-gray-900 p-3 text-sm outline-none";

function formatWait(seconds: number) {
    return seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
}

export default function LoginPage() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [totp, setTotp] = useState("");
    const [deviceName, setDeviceName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [fields, setFields] = useState<Record<string, string>>({});
    const [retryLeft, setRetryLeft] = useState(0);

    useEffect(() => {
        if (retryLeft <= 0) return;
        const timer = setTimeout(() => setRetryLeft((s) => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [retryLeft]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy || retryLeft > 0) return;
        setBusy(true);
        setError("");
        setFields({});
        try {
            await login({ password, totp, deviceName: deviceName.trim() || undefined });
            router.replace("/");
        } catch (e) {
            setTotp("");
            if (!(e instanceof ApiError)) setError("서버에 연결할 수 없습니다.");
            else if (e.status === 429) setRetryLeft(e.retryAfterSeconds ?? 60);
            else if (e.status === 401) setError("비밀번호 또는 인증 코드가 올바르지 않습니다.");
            else if (e.status === 400 && Object.keys(e.fields).length > 0) setFields(e.fields);
            else setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6">
            <h1 className="mb-6 text-2xl font-bold">로그인</h1>
            <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm">
                    <span className="mb-1 block text-gray-400">비밀번호</span>
                    <input
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={200}
                        autoFocus
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={!!fields.password}
                        className={inputClass}
                    />
                    {fields.password && <span className="mt-1 block text-red-400">{fields.password}</span>}
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block text-gray-400">인증 코드 (6자리)</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        pattern="\d{6}"
                        maxLength={6}
                        value={totp}
                        onChange={(e) => setTotp(e.target.value)}
                        aria-invalid={!!fields.totp}
                        className={inputClass}
                    />
                    {fields.totp && <span className="mt-1 block text-red-400">{fields.totp}</span>}
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block text-gray-400">기기 이름 (선택)</span>
                    <input
                        type="text"
                        autoComplete="off"
                        maxLength={100}
                        placeholder="예: 아이폰"
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value)}
                        aria-invalid={!!fields.deviceName}
                        className={inputClass}
                    />
                    {fields.deviceName && <span className="mt-1 block text-red-400">{fields.deviceName}</span>}
                </label>
                <div role="alert" className="text-sm text-red-400">
                    {retryLeft > 0 ? `시도 횟수를 초과했습니다. ${formatWait(retryLeft)} 후 다시 시도하세요.` : error}
                </div>
                <button
                    type="submit"
                    disabled={busy || retryLeft > 0}
                    className="w-full rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-40"
                >
                    {busy ? "확인 중…" : "로그인"}
                </button>
            </form>
        </main>
    );
}
