"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Log = { t: string; msg: string };
const WS_STATE = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];

export default function MicTestPage() {
    const [logs, setLogs] = useState<Log[]>([]);
    const [running, setRunning] = useState(false);
    const stopRef = useRef<() => void>(() => {});

    const log = (msg: string) =>
        setLogs((prev) =>
            [{ t: new Date().toLocaleTimeString("ko-KR"), msg }, ...prev].slice(0, 300),
        );

    useEffect(() => {
        const onVis = () => log(`👁 visibility: ${document.visibilityState}`);
        const onHide = () => log("pagehide");
        const onShow = () => log("pageshow");
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pagehide", onHide);
        window.addEventListener("pageshow", onShow);
        return () => {
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("pagehide", onHide);
            window.removeEventListener("pageshow", onShow);
        };
    }, []);

    const start = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const track = stream.getAudioTracks()[0];
            track.onended = () => log("🔴 mic track ended");
            track.onmute = () => log("🟠 mic muted");
            track.onunmute = () => log("🟢 mic unmuted");

            const ctx = new AudioContext();
            ctx.onstatechange = () => log(`🔊 AudioContext: ${ctx.state}`);
            const analyser = ctx.createAnalyser();
            ctx.createMediaStreamSource(stream).connect(analyser);
            const buf = new Uint8Array(analyser.fftSize);

            const ws = new WebSocket("wss://echo.websocket.org");
            ws.onopen = () => log("🟢 WS open");
            ws.onclose = (e) => log(`🔴 WS closed (code ${e.code})`);
            ws.onerror = () => log("🔴 WS error");

            let last = Date.now();
            const timer = setInterval(() => {
                const now = Date.now();
                const gap = now - last;
                last = now;
                if (gap > 4000) log(`⚠️ ${(gap / 1000).toFixed(1)}초 동안 멈춤`);

                analyser.getByteTimeDomainData(buf);
                let peak = 0;
                for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));

                if (ws.readyState === WebSocket.OPEN) ws.send(String(now));
                log(`mic ${peak} · track ${track.readyState} · ws ${WS_STATE[ws.readyState]}`);
            }, 2000);

            stopRef.current = () => {
                clearInterval(timer);
                ws.close();
                stream.getTracks().forEach((t) => t.stop());
                ctx.close();
            };
            setRunning(true);
            log("▶️ 시작");
        } catch (e) {
            log(`❌ ${(e as Error).message}`);
        }
    };

    const stop = () => {
        stopRef.current();
        setRunning(false);
        log("⏹ 정지");
    };

    return (
        <main className="mx-auto max-w-md p-4 font-mono text-sm">
            <h1 className="mb-3 text-lg font-bold">Mic / Lock Test</h1>
            <Link href="/" className="mb-2 inline-block text-sm text-gray-600">← 홈</Link>
            <button
                onClick={running ? stop : start}
                className="mb-4 w-full rounded-lg bg-violet-600 py-3 font-bold text-white"
            >
                {running ? "정지" : "시작"}
            </button>
            <ul className="space-y-1">
                {logs.map((l, i) => (
                    <li key={i}>
                        <span className="text-gray-600">{l.t}</span> {l.msg}
                    </li>
                ))}
            </ul>
        </main>
    );
}