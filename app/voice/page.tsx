"use client";

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { useRef, useState } from "react";

const MODEL = "gemini-3.1-flash-live-preview";

function toBase64(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

function base64ToFloat32(b64: string) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
    return out;
}

type Refs = {
    session?: Session;
    ctx?: AudioContext;
    stream?: MediaStream;
    node?: AudioWorkletNode;
    nextTime: number;
    sources: Set<AudioBufferSourceNode>;
};

export default function VoicePage() {
    const [status, setStatus] = useState("대기");
    const [lines, setLines] = useState<string[]>([]);
    const r = useRef<Refs>({ nextTime: 0, sources: new Set() });

    const appendText = (who: string, text: string) =>
        setLines((p) => {
            const last = p[p.length - 1];
            if (last?.startsWith(who)) return [...p.slice(0, -1), last + text];
            return [...p.slice(-50), `${who} ${text}`];
        });

    const play = (b64: string) => {
        const ctx = r.current.ctx!;
        const data = base64ToFloat32(b64);
        const buf = ctx.createBuffer(1, data.length, 24000);
        buf.copyToChannel(data, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        r.current.nextTime = Math.max(r.current.nextTime, ctx.currentTime);
        src.start(r.current.nextTime);
        r.current.nextTime += buf.duration;
        r.current.sources.add(src);
        src.onended = () => r.current.sources.delete(src);
    };

    const stopPlayback = () => {
        r.current.sources.forEach((s) => {
            try {
                s.stop();
            } catch {}
        });
        r.current.sources.clear();
        r.current.nextTime = 0;
    };

    const onMessage = (msg: LiveServerMessage) => {
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) stopPlayback();
        sc.modelTurn?.parts?.forEach((p) => {
            if (p.inlineData?.data) play(p.inlineData.data);
        });
        if (sc.inputTranscription?.text) appendText("🙋", sc.inputTranscription.text);
        if (sc.outputTranscription?.text) appendText("🤖", sc.outputTranscription.text);
    };

    const start = async () => {
        try {
            setStatus("연결 중");
            const ctx = new AudioContext();
            await ctx.resume();
            await ctx.audioWorklet.addModule("/pcm-recorder.js");

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });

            const { token } = await fetch("/api/live-token", { method: "POST" }).then((res) => res.json());
            const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

            const session = await ai.live.connect({
                model: MODEL,
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: "너는 사용자의 개인 AI 매니저야. 한국어로 짧고 자연스럽게 대답해.",
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
                callbacks: {
                    onopen: () => setStatus("연결됨 · 말해보세요"),
                    onmessage: onMessage,
                    onerror: (e) => appendText("❌", e.message),
                    onclose: (e) => setStatus(`종료 (code ${e.code}) ${e.reason ?? ""}`),
                },
            });

            const source = ctx.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(ctx, "pcm-recorder");
            node.port.onmessage = (e) =>
                session.sendRealtimeInput({
                    audio: { data: toBase64(e.data), mimeType: "audio/pcm;rate=16000" },
                });

            const mute = ctx.createGain();
            mute.gain.value = 0;
            source.connect(node).connect(mute).connect(ctx.destination);

            Object.assign(r.current, { session, ctx, stream, node });
        } catch (e) {
            setStatus(`실패: ${(e as Error).message}`);
        }
    };

    const stop = () => {
        const c = r.current;
        c.session?.close();
        c.node?.disconnect();
        c.stream?.getTracks().forEach((t) => t.stop());
        stopPlayback();
        c.ctx?.close();
        setStatus("대기");
    };

    const running = status !== "대기" && !status.startsWith("실패") && !status.startsWith("종료");

    return (
        <main className="mx-auto max-w-md p-4">
            <h1 className="mb-2 text-xl font-bold">통화 모드</h1>
            <p className="mb-4 text-sm text-gray-400">{status}</p>
            <button
                onClick={running ? stop : start}
                className={`mb-6 w-full rounded-full py-4 text-lg font-bold text-white ${running ? "bg-red-600" : "bg-blue-600"}`}
            >
                {running ? "통화 종료" : "🎙️ 통화 시작"}
            </button>
            <ul className="space-y-2 text-sm">
                {lines.map((l, i) => (
                    <li key={i}>{l}</li>
                ))}
            </ul>
        </main>
    );
}