"use client";

import Link from "next/link";
import {
    GoogleGenAI,
    Modality,
    Type,
    type LiveServerMessage,
    type LiveServerToolCall,
    type Session,
} from "@google/genai";
import { useEffect, useRef, useState } from "react";
import { apiFetch, getPasscode } from "@/lib/api";
import { TurnController, type TurnState } from "@/lib/turn";

const MODEL = "gemini-3.8-live";
const API_VERSION = "v1beta";

const SYSTEM_INSTRUCTION = `너는 사용자의 개인 AI 매니저야. 사용자는 주로 이동 중에 이어폰으로 너와 대화해.

- 한국어로 짧고 자연스럽게 말해. 사용자는 화면을 보지 않으니 긴 목록이나 코드를 읽어주지 마.
- 문서, 기획서, 코드, 정리본처럼 길고 공들인 결과물이 필요한 요청은 직접 답하지 말고 delegate_task 도구로 맡겨.
- delegate_task를 쓸 때는, 작업자가 이 대화를 듣지 못한다는 점을 기억해. 대화에서 나온 아이디어와 조건, 세부 내용을 빠짐없이 context에 정리해서 넘겨.
- 맡긴 뒤에는 "맡겨뒀어요, 나중에 문서함에서 확인하세요"처럼 짧게 알려줘.
- 맡긴 작업이 어떻게 됐는지 물으면 list_recent_tasks를 써.`;

const TOOLS = [
    {
        functionDeclarations: [
            {
                name: "delegate_task",
                description:
                    "문서, 기획서, 코드, 정리본 등 시간이 걸리는 결과물 작성을 백그라운드 작업자에게 맡긴다.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        instruction: {
                            type: Type.STRING,
                            description: "무엇을 만들어야 하는지 한두 문장으로 명확하게",
                        },
                        context: {
                            type: Type.STRING,
                            description:
                                "작업자는 대화를 듣지 못하므로, 대화에서 나온 아이디어, 조건, 세부 내용을 빠짐없이 정리한 것",
                        },
                    },
                    required: ["instruction", "context"],
                },
            },
            {
                name: "list_recent_tasks",
                description: "최근에 맡긴 작업들의 진행 상태를 확인한다.",
            },
        ],
    },
];

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string) {
    return Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} 시간 초과`)), ms)),
    ]);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type Refs = {
    session?: Session;
    ctx?: AudioContext;
    stream?: MediaStream;
    node?: AudioWorkletNode;
    wakeLock?: WakeLockSentinel;
    nextTime: number;
    sources: Set<AudioBufferSourceNode>;
    active: boolean;
    reconnecting: boolean;
    attempts: number;
    sessionId: number;
};

export default function VoicePage() {
    const [status, setStatus] = useState("대기");
    const [active, setActive] = useState(false);
    const [needTap, setNeedTap] = useState(false);
    const [lines, setLines] = useState<string[]>([]);
    const [turn, setTurn] = useState<TurnState>("idle");
    const awaitingFollowUp = useRef(false);
    const r = useRef<Refs>({
        nextTime: 0,
        sources: new Set(),
        active: false,
        reconnecting: false,
        attempts: 0,
        sessionId: 0,
    });

    const appendText = (who: string, text: string) =>
        setLines((p) => {
            const last = p[p.length - 1];
            if (last?.startsWith(who)) return [...p.slice(0, -1), last + text];
            return [...p.slice(-50), `${who} ${text}`];
        });

    // ---------- 재생 ----------
    const stopPlayback = () => {
        r.current.sources.forEach((s) => {
            try {
                s.stop();
            } catch {}
        });
        r.current.sources.clear();
        r.current.nextTime = 0;
    };

    const beep = (freq: number) => {
        const ctx = r.current.ctx;
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.08;
        osc.frequency.value = freq;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    };

    // ---------- 말차례 ----------
    const turnRef = useRef<TurnController | null>(null);
    if (!turnRef.current) {
        turnRef.current = new TurnController({
            onStart: () => {
                stopPlayback();
                r.current.session?.sendRealtimeInput({ activityStart: {} });
            },
            onAudio: (buf) =>
                r.current.session?.sendRealtimeInput({
                    audio: { data: toBase64(buf), mimeType: "audio/pcm;rate=16000" },
                }),
            onEnd: () => r.current.session?.sendRealtimeInput({ activityEnd: {} }),
            onState: setTurn,
        });
    }

    const armFollowUp = () => {
        if (!r.current.active || !r.current.session) return;
        turnRef.current?.arm(8000);
    };

    const play = (b64: string) => {
        const ctx = r.current.ctx;
        if (!ctx) return;
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
        src.onended = () => {
            r.current.sources.delete(src);
            if (r.current.sources.size === 0 && awaitingFollowUp.current) {
                awaitingFollowUp.current = false;
                armFollowUp();
            }
        };
    };

    // ---------- 도구 ----------
    const handleToolCall = async (toolCall: LiveServerToolCall) => {
        const session = r.current.session;
        if (!session) return;

        const functionResponses = await Promise.all(
            (toolCall.functionCalls ?? []).map(async (fc) => {
                try {
                    if (fc.name === "delegate_task") {
                        const args = fc.args as { instruction: string; context?: string };
                        const res = await apiFetch("/tasks", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ instruction: args.instruction, context: args.context }),
                        });
                        const task = await res.json();
                        appendText("📝", `작업 접수: ${args.instruction}`);
                        return {
                            id: fc.id,
                            name: fc.name,
                            response: {
                                result: "접수 완료. 백그라운드에서 작성 중이고, 끝나면 문서함에서 볼 수 있음",
                                taskId: task.id,
                            },
                        };
                    }

                    if (fc.name === "list_recent_tasks") {
                        const res = await apiFetch("/tasks");
                        const list = (await res.json()) as { instruction: string; status: string }[];
                        return {
                            id: fc.id,
                            name: fc.name,
                            response: {
                                tasks: list.slice(0, 5).map((t) => ({
                                    instruction: t.instruction.slice(0, 60),
                                    status: t.status,
                                })),
                            },
                        };
                    }

                    return { id: fc.id, name: fc.name, response: { error: "알 수 없는 도구" } };
                } catch (e) {
                    appendText("❌", `도구 실패: ${(e as Error).message}`);
                    return { id: fc.id, name: fc.name, response: { error: (e as Error).message } };
                }
            }),
        );

        session.sendToolResponse({ functionResponses });
    };

    const onMessage = (msg: LiveServerMessage) => {
        if (msg.toolCall) handleToolCall(msg.toolCall);

        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) stopPlayback();
        sc.modelTurn?.parts?.forEach((p) => {
            if (p.inlineData?.data) play(p.inlineData.data);
        });
        if (sc.inputTranscription?.text) appendText("🙋", sc.inputTranscription.text);
        if (sc.outputTranscription?.text) appendText("🤖", sc.outputTranscription.text);
        if (sc.turnComplete) {
            if (r.current.sources.size === 0) armFollowUp();
            else awaitingFollowUp.current = true;
        }
    };

    // ---------- 화면 꺼짐 방지 ----------
    const requestWakeLock = async () => {
        try {
            r.current.wakeLock = await navigator.wakeLock.request("screen");
        } catch {}
    };

    const releaseWakeLock = () => {
        r.current.wakeLock?.release().catch(() => {});
        r.current.wakeLock = undefined;
    };

    // ---------- 오디오 (탭 필요) ----------
    const audioHealthy = () => {
        const c = r.current;
        const track = c.stream?.getAudioTracks()[0];
        return !!c.ctx && c.ctx.state === "running" && track?.readyState === "live" && !track.muted;
    };

    const setupAudio = async () => {
        const c = r.current;
        const ctx = new AudioContext();
        c.ctx = ctx;
        await withTimeout(ctx.resume(), 3000, "오디오 시작");
        await ctx.audioWorklet.addModule("/pcm-recorder.js");

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        c.stream = stream;

        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-recorder");
        node.port.onmessage = (e) => turnRef.current?.feed(e.data);
        c.node = node;

        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node).connect(mute).connect(ctx.destination);
    };

    const teardownAudio = () => {
        const c = r.current;
        c.node?.disconnect();
        c.stream?.getTracks().forEach((t) => t.stop());
        stopPlayback();
        c.ctx?.close().catch(() => {});
        Object.assign(c, { ctx: undefined, stream: undefined, node: undefined });
    };

    // ---------- Gemini 세션 (탭 불필요) ----------
    const closeSession = () => {
        const c = r.current;
        const s = c.session;
        c.session = undefined;
        c.sessionId++;
        turnRef.current?.disarm();
        try {
            s?.close();
        } catch {}
    };

    const connectSession = async () => {
        const c = r.current;

        const res = await withTimeout(
            fetch("/api/live-token", {
                method: "POST",
                headers: { "x-app-passcode": getPasscode() },
            }),
            8000,
            "토큰 발급",
        );
        if (res.status === 401) {
            try {
                localStorage.removeItem("passcode");
            } catch {}
            throw new Error("접속 코드가 틀렸습니다");
        }
        const { token } = await res.json();

        let userContext = "";
        try {
            const ctxRes = await withTimeout(apiFetch("/context/voice"), 5000, "맥락 조회");
            userContext = (await ctxRes.json()).text;
        } catch {
            // 맥락을 못 가져와도 통화는 진행
        }

        const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: API_VERSION } });
        const id = ++c.sessionId;

        const session = await withTimeout(
            ai.live.connect({
                model: MODEL,
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: userContext
                        ? `${SYSTEM_INSTRUCTION}\n\n## 사용자 정보\n${userContext}`
                        : SYSTEM_INSTRUCTION,
                    tools: TOOLS,
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
                },
                callbacks: {
                    onmessage: (m) => {
                        if (id === r.current.sessionId) onMessage(m);
                    },
                    onerror: (e) => appendText("❌", e.message || "연결 오류"),
                    onclose: (e) => {
                        if (id !== r.current.sessionId || !r.current.active) return;
                        r.current.session = undefined;
                        turnRef.current?.disarm();
                        if (document.visibilityState === "visible") {
                            recover(`연결 끊김 ${e.code}`);
                        } else {
                            setStatus(`연결 끊김 (code ${e.code}) · 돌아오면 재연결`);
                        }
                    },
                },
            }),
            10000,
            "Gemini 연결",
        );

        c.session = session;
        c.attempts = 0;
        setStatus("연결됨 · 버튼을 누르고 말하세요");
    };

    // ---------- 시작 / 복구 / 종료 ----------
    const start = async () => {
        const c = r.current;
        c.active = true;
        c.attempts = 0;
        setActive(true);
        setNeedTap(false);
        try {
            setStatus("연결 중");
            closeSession();
            teardownAudio();
            await setupAudio();
            await connectSession();
            await requestWakeLock();
        } catch (e) {
            c.active = false;
            setActive(false);
            closeSession();
            teardownAudio();
            releaseWakeLock();
            setStatus(`실패: ${(e as Error).message}`);
        }
    };

    const recover = async (reason: string) => {
        const c = r.current;
        if (!c.active || c.reconnecting) return;
        c.reconnecting = true;
        try {
            setStatus(`재연결 중 (${reason})`);

            if (c.ctx && c.ctx.state !== "running") {
                await withTimeout(c.ctx.resume(), 1500, "오디오 재개").catch(() => {});
            }

            if (!audioHealthy()) {
                closeSession();
                setStatus(`오디오가 멈췄어요 (${reason}) · 버튼을 눌러 다시 시작`);
                setNeedTap(true);
                return;
            }

            while (!c.session) {
                c.attempts++;
                if (c.attempts > 3) throw new Error("재연결 3회 실패");
                setStatus(`재연결 중 (${reason}) · ${c.attempts}회차`);
                await sleep(1000);
                try {
                    await connectSession();
                } catch {}
            }

            await requestWakeLock();
        } catch (e) {
            closeSession();
            setStatus(`실패: ${(e as Error).message} · 버튼을 눌러 다시 시작`);
            setNeedTap(true);
        } finally {
            c.reconnecting = false;
        }
    };

    const stop = () => {
        r.current.active = false;
        setActive(false);
        setNeedTap(false);
        closeSession();
        teardownAudio();
        releaseWakeLock();
        setStatus("대기");
    };

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState !== "visible" || !r.current.active) return;
            const problems: string[] = [];
            if (!r.current.session) problems.push("연결");
            if (!audioHealthy()) problems.push("오디오/마이크");
            if (problems.length > 0) recover(problems.join(", "));
            else requestWakeLock();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onButton = () => {
        if (needTap || !active) start();
        else stop();
    };

    return (
        <main className="mx-auto max-w-md p-4">
            <Link href="/" className="mb-2 inline-block text-sm text-gray-400">
                ← 홈
            </Link>
            <h1 className="mb-2 text-xl font-bold">통화 모드</h1>
            <p className="mb-4 text-sm text-gray-400">{status}</p>
            <button
                onClick={onButton}
                className={`mb-4 w-full rounded-full py-4 text-lg font-bold text-white ${
                    needTap ? "bg-amber-500" : active ? "bg-red-600" : "bg-blue-600"
                }`}
            >
                {needTap ? "🔄 다시 시작" : active ? "통화 종료" : "🎙️ 통화 시작"}
            </button>
            {active && !needTap && (
                <button
                    onClick={() => {
                        beep(880);
                        turnRef.current?.arm(5000);
                    }}
                    disabled={turn !== "idle"}
                    className={`mb-6 w-full rounded-full py-6 text-lg font-bold text-white ${
                        turn === "speaking" ? "bg-red-500" : turn === "armed" ? "bg-green-600" : "bg-gray-700"
                    }`}
                >
                    {turn === "speaking" ? "🔴 듣는 중…" : turn === "armed" ? "🟢 말하세요" : "🎙️ 눌러서 말하기"}
                </button>
            )}
            <ul className="space-y-2 text-sm">
                {lines.map((l, i) => (
                    <li key={i}>{l}</li>
                ))}
            </ul>
        </main>
    );
}