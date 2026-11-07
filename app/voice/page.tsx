"use client";

import Link from "next/link";
import {
    type FunctionDeclaration,
    GoogleGenAI,
    Modality,
    type LiveServerMessage,
    type LiveServerToolCall,
    type Session,
} from "@google/genai";
import { useEffect, useRef, useState } from "react";
import { apiFetch, authFetch } from "@/lib/api";
import { addFragment, beginCall, breakTurn, type CallRecord, endCall, flushCalls, saveCall } from "@/lib/call-record";
import { loadDeclarations, LOCAL_DECLARATIONS, runTool } from "@/lib/voice-tools";

const MODEL = "gemini-3.8-live";
const API_VERSION = "v1beta";
const WAKE_NAME = "수피";

const SYSTEM_INSTRUCTION = `너의 이름은 ${WAKE_NAME}야. 너는 사용자의 개인 AI 매니저고, 사용자는 주로 이동 중에 이어폰으로 너와 대화해.

- 마이크는 통화 내내 켜져 있어. 사용자가 "${WAKE_NAME}" 또는 "${WAKE_NAME}야"라고 부르며 한 말에만 답해.
- 이름을 부르지 않은 말, 주변 사람들끼리의 대화, TV나 거리 소리에는 답하지 말고 조용히 있어.
- 네가 방금 답한 직후 사용자가 이어서 묻는 말에는 이름이 없어도 답해.
- 한국어로 짧고 자연스럽게 말해. 사용자는 화면을 보지 않으니 긴 목록이나 코드를 읽어주지 마.
- 문서, 기획서, 코드, 정리본처럼 길고 공들인 결과물이 필요한 요청은 직접 답하지 말고 create_task 도구로 맡겨.
- create_task를 쓸 때는, 작업자가 이 대화를 듣지 못한다는 점을 기억해. 대화에서 나온 아이디어와 조건, 세부 내용을 빠짐없이 context에 정리해서 넘겨.
- 맡긴 뒤에는 "맡겨뒀어요, 나중에 문서함에서 확인하세요"처럼 짧게 알려줘.
- 맡긴 작업이 어떻게 됐는지 물으면 list_recent_tasks를 써.
- 기억, 루틴, 활동 기록, 목표는 해당 도구로 처리해. 도구가 실패하면 사유를 짧게 알려줘.`;

const TOOLS_UNAVAILABLE =
    "\n\n지금은 서버 도구를 쓸 수 없어. 문서 맡기기, 기억, 루틴, 활동 기록, 목표 요청을 받으면 지금은 처리할 수 없다고 알려줘.";

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

/** 16비트 PCM 조각의 소리 크기 (0~1) */
function rms(buf: ArrayBuffer) {
    const a = new Int16Array(buf);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i] / 32768) ** 2;
    return Math.sqrt(sum / Math.max(1, a.length));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string) {
    return Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} 시간 초과`)), ms)),
    ]);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const sendCall = (call: CallRecord) =>
    apiFetch("/voice/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(call),
    });

type Note = { text: string; tone: "ok" | "warn" | "error" };
const NOTE_CLASS: Record<Note["tone"], string> = {
    ok: "bg-violet-100 text-violet-900",
    warn: "bg-amber-100 text-amber-900",
    error: "bg-red-100 text-red-800",
};

type Refs = {
    session?: Session;
    ctx?: AudioContext;
    stream?: MediaStream;
    node?: AudioWorkletNode;
    out?: AnalyserNode;
    wakeLock?: WakeLockSentinel;
    raf?: number;
    nextTime: number;
    sources: Set<AudioBufferSourceNode>;
    active: boolean;
    paused: boolean;
    inLevel: number;
    reconnecting: boolean;
    attempts: number;
    sessionId: number;
    tools?: FunctionDeclaration[];
};

export default function VoicePage() {
    const [status, setStatus] = useState("");
    const [active, setActive] = useState(false);
    const [needTap, setNeedTap] = useState(false);
    const [paused, setPaused] = useState(false);
    const [replying, setReplying] = useState(false);
    const [note, setNote] = useState<Note | null>(null);
    const orbRef = useRef<HTMLButtonElement>(null);
    const r = useRef<Refs>({
        nextTime: 0,
        sources: new Set(),
        active: false,
        paused: false,
        inLevel: 0,
        reconnecting: false,
        attempts: 0,
        sessionId: 0,
    });

    const finishCall = async () => {
        endCall();
        const result = await flushCalls(sendCall);
        if (result === "retry") setNote({ text: "통화 기록을 보내지 못했어요. 다음에 통화 화면을 열 때 다시 보냅니다.", tone: "warn" });
        else if (result === "dropped") setNote({ text: "서버가 통화 기록을 거부해 저장하지 못했어요.", tone: "warn" });
    };

    // ---------- 재생 ----------
    const stopPlayback = () => {
        r.current.sources.forEach((s) => {
            try {
                s.stop();
            } catch {}
        });
        r.current.sources.clear();
        r.current.nextTime = 0;
        setReplying(false);
    };

    const play = (b64: string) => {
        const c = r.current;
        const ctx = c.ctx;
        if (!ctx) return;
        const data = base64ToFloat32(b64);
        const buf = ctx.createBuffer(1, data.length, 24000);
        buf.copyToChannel(data, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(c.out ?? ctx.destination);
        c.nextTime = Math.max(c.nextTime, ctx.currentTime);
        src.start(c.nextTime);
        c.nextTime += buf.duration;
        if (c.sources.size === 0) setReplying(true);
        c.sources.add(src);
        src.onended = () => {
            c.sources.delete(src);
            if (c.sources.size === 0) setReplying(false);
        };
    };

    // ---------- 도구 ----------
    const handleToolCall = async (toolCall: LiveServerToolCall) => {
        const session = r.current.session;
        if (!session) return;

        const functionResponses = await Promise.all(
            (toolCall.functionCalls ?? []).map(async (fc) => {
                try {
                    const { response, note } = await runTool(apiFetch, fc.name ?? "", fc.args);
                    if (note) setNote({ text: note, tone: response.error ? "error" : "ok" });
                    return { id: fc.id, name: fc.name, response };
                } catch (e) {
                    setNote({ text: `도구 실패: ${(e as Error).message}`, tone: "error" });
                    return { id: fc.id, name: fc.name, response: { error: (e as Error).message } };
                }
            }),
        );

        // 도구 실행 중 재연결되면 닫힌 세션이라 보낼 곳이 없다
        if (r.current.session === session) session.sendToolResponse({ functionResponses });
    };

    const onMessage = (msg: LiveServerMessage) => {
        if (msg.toolCall) handleToolCall(msg.toolCall);

        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) {
            stopPlayback();
            breakTurn();
        }
        sc.modelTurn?.parts?.forEach((p) => {
            if (p.inlineData?.data) play(p.inlineData.data);
        });
        if (sc.inputTranscription?.text) addFragment("user", sc.inputTranscription.text);
        if (sc.outputTranscription?.text) addFragment("assistant", sc.outputTranscription.text);
        if (sc.turnComplete) {
            breakTurn();
            saveCall();
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
        // 이름 호출을 Gemini가 판단하므로 듣기를 멈추지 않은 동안은 계속 보낸다
        node.port.onmessage = (e) => {
            c.inLevel = rms(e.data);
            if (c.paused || !c.session) return;
            try {
                c.session.sendRealtimeInput({ audio: { data: toBase64(e.data), mimeType: "audio/pcm;rate=16000" } });
            } catch {}
        };
        c.node = node;

        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node).connect(mute).connect(ctx.destination);

        // AI 목소리 크기를 원의 움직임에 쓴다
        const out = ctx.createAnalyser();
        out.fftSize = 512;
        out.connect(ctx.destination);
        c.out = out;

        const samples = new Float32Array(out.fftSize);
        const loop = () => {
            out.getFloatTimeDomainData(samples);
            let sum = 0;
            for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
            const level = c.sources.size > 0 ? Math.sqrt(sum / samples.length) : c.paused ? 0 : c.inLevel;
            orbRef.current?.style.setProperty("--level", Math.min(1, level * 6).toFixed(3));
            c.raf = requestAnimationFrame(loop);
        };
        c.raf = requestAnimationFrame(loop);
    };

    const teardownAudio = () => {
        const c = r.current;
        if (c.raf) cancelAnimationFrame(c.raf);
        orbRef.current?.style.setProperty("--level", "0");
        c.node?.disconnect();
        c.stream?.getTracks().forEach((t) => t.stop());
        stopPlayback();
        c.ctx?.close().catch(() => {});
        Object.assign(c, { ctx: undefined, stream: undefined, node: undefined, out: undefined, raf: undefined, inLevel: 0 });
    };

    // ---------- Gemini 세션 (탭 불필요) ----------
    const closeSession = () => {
        const c = r.current;
        const s = c.session;
        c.session = undefined;
        c.sessionId++;
        try {
            s?.close();
        } catch {}
    };

    const connectSession = async () => {
        const c = r.current;

        const res = await withTimeout(authFetch("/api/live-token", { method: "POST" }), 8000, "토큰 발급");
        const { token } = await res.json();

        let userContext = "";
        try {
            const ctxRes = await withTimeout(apiFetch("/context/voice"), 5000, "맥락 조회");
            userContext = (await ctxRes.json()).text;
        } catch {
            // 맥락을 못 가져와도 통화는 진행
        }

        if (!c.tools) {
            try {
                c.tools = await withTimeout(loadDeclarations(apiFetch), 5000, "도구 조회");
            } catch {
                setNote({ text: "도구를 불러오지 못해 작업 조회만 쓸 수 있어요.", tone: "warn" });
            }
        }

        const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: API_VERSION } });
        const id = ++c.sessionId;

        const session = await withTimeout(
            ai.live.connect({
                model: MODEL,
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction:
                        SYSTEM_INSTRUCTION +
                        (c.tools ? "" : TOOLS_UNAVAILABLE) +
                        (userContext ? `\n\n## 사용자 정보\n${userContext}` : ""),
                    tools: [{ functionDeclarations: c.tools ?? LOCAL_DECLARATIONS }],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    // 자기에게 한 말이 아니면 답하지 않는다 (이름 호출)
                    proactivity: { proactiveAudio: true },
                    // 마이크를 계속 보내 대화가 빨리 길어지므로 오래된 부분부터 덜어 낸다
                    contextWindowCompression: { slidingWindow: {} },
                },
                callbacks: {
                    onmessage: (m) => {
                        if (id === r.current.sessionId) onMessage(m);
                    },
                    onerror: (e) => setNote({ text: e.message || "연결 오류", tone: "error" }),
                    onclose: (e) => {
                        if (id !== r.current.sessionId || !r.current.active) return;
                        r.current.session = undefined;
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
        setStatus("연결됨");
    };

    // ---------- 시작 / 복구 / 종료 ----------
    const start = async () => {
        const c = r.current;
        c.active = true;
        c.paused = false;
        c.attempts = 0;
        setActive(true);
        setPaused(false);
        setNeedTap(false);
        setNote(null);
        beginCall();
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
            finishCall();
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
                setStatus(`오디오가 멈췄어요 (${reason})`);
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
            setStatus(`실패: ${(e as Error).message}`);
            setNeedTap(true);
        } finally {
            c.reconnecting = false;
        }
    };

    const stop = () => {
        r.current.active = false;
        setActive(false);
        setNeedTap(false);
        setPaused(false);
        closeSession();
        teardownAudio();
        releaseWakeLock();
        setStatus("");
        finishCall();
    };

    const togglePause = () => {
        const c = r.current;
        c.paused = !c.paused;
        setPaused(c.paused);
        if (c.paused) {
            try {
                c.session?.sendRealtimeInput({ audioStreamEnd: true });
            } catch {}
        }
    };

    useEffect(() => {
        const refs = r.current;
        flushCalls(sendCall); // 지난번에 못 보낸 기록
        const onVisible = () => {
            if (document.visibilityState === "hidden") saveCall();
            if (document.visibilityState !== "visible" || !r.current.active) return;
            const problems: string[] = [];
            if (!r.current.session) problems.push("연결");
            if (!audioHealthy()) problems.push("오디오/마이크");
            if (problems.length > 0) recover(problems.join(", "));
            else requestWakeLock();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            // 통화 중 다른 화면으로 나가면 세션과 마이크가 남고 기록도 마무리되지 않는다
            if (refs.active) stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const phase = !active || needTap ? "idle" : paused ? "paused" : replying ? "replying" : "listening";
    const label = {
        idle: needTap ? "눌러서 다시 시작" : "눌러서 통화 시작",
        paused: "듣기를 멈췄어요",
        replying: "답하는 중",
        listening: `"${WAKE_NAME}야" 하고 불러 주세요`,
    }[phase];
    const orbAction = { idle: label, paused: "다시 듣기", replying: "듣기 멈추기", listening: "듣기 멈추기" }[phase];
    const dot = { idle: "bg-gray-400", paused: "bg-amber-500", replying: "bg-violet-600", listening: "bg-green-600" }[phase];

    return (
        <main className="mx-auto flex h-dvh w-full max-w-md flex-col px-5 pt-4 pb-8">
            <header className="flex h-11 items-center justify-between">
                <Link href="/" aria-label="홈으로" className="flex size-11 items-center justify-center rounded-full text-gray-700">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </Link>
                <span role="status" className="max-w-[70%] truncate text-sm text-gray-600">
                    {status}
                </span>
            </header>

            <div className="flex flex-1 flex-col items-center justify-center gap-6">
                <button ref={orbRef} onClick={() => (phase === "idle" ? start() : togglePause())} aria-label={orbAction} data-phase={phase} className="orb">
                    <span className="orb-shape">
                        <span className="orb-fill" />
                    </span>
                </button>
                <p className="min-h-5 text-sm text-gray-600">{phase === "idle" ? "" : phase === "paused" ? "원을 누르면 다시 들어요" : "원을 누르면 듣기를 멈춰요"}</p>
            </div>

            {note && <p className={`mb-5 self-center rounded-full px-4 py-2 text-center text-sm ${NOTE_CLASS[note.tone]}`}>{note.text}</p>}

            <div className="flex items-center justify-between gap-3">
                <span className="flex min-h-11 items-center gap-2 rounded-full bg-gray-100 px-4 text-sm text-gray-900">
                    <span className={`size-2 rounded-full ${dot}`} />
                    {label}
                </span>
                {active && (
                    <button onClick={stop} aria-label="통화 종료" className="flex size-13 items-center justify-center rounded-full bg-red-600 text-white">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 6L6 18" />
                            <path d="M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
        </main>
    );
}
