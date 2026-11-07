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
import { FOLLOW_UP_MS, WAKE_PATTERN, WakeGate } from "@/lib/wake-gate";

const MODEL = "gemini-3.8-live";
const API_VERSION = "v1beta";
const WAKE_NAME = "수피";

const SYSTEM_INSTRUCTION = `너의 이름은 ${WAKE_NAME}야. 너는 사용자의 개인 AI 매니저고, 사용자는 주로 이동 중에 이어폰으로 너와 대화해.

- 너에게는 사용자가 "${WAKE_NAME}"를 부르거나 버튼을 누른 뒤의 소리만 전달돼. 들어온 말에 답해.
- 다만 주변 사람들끼리의 대화나 TV 소리처럼 분명히 너에게 한 말이 아니면 조용히 있어.
- 한국어로 짧고 자연스럽게 말해. 사용자는 화면을 보지 않으니 긴 목록이나 코드를 읽어주지 마.
- 문서, 기획서, 코드, 정리본처럼 길고 공들인 결과물이 필요한 요청은 직접 답하지 말고 create_task 도구로 맡겨.
- create_task를 쓸 때는, 작업자가 이 대화를 듣지 못한다는 점을 기억해. 대화에서 나온 아이디어와 조건, 세부 내용을 빠짐없이 context에 정리해서 넘겨.
- 맡긴 뒤에는 "맡겨뒀어요, 나중에 문서함에서 확인하세요"처럼 짧게 알려줘.
- 맡긴 작업이 어떻게 됐는지 물으면 list_recent_tasks를 써.
- 기억, 루틴, 활동 기록, 목표는 해당 도구로 처리해. 도구가 실패하면 사유를 짧게 알려줘.`;

const TOOLS_UNAVAILABLE =
    "\n\n지금은 서버 도구를 쓸 수 없어. 문서 맡기기, 기억, 루틴, 활동 기록, 목표 요청을 받으면 지금은 처리할 수 없다고 알려줘.";

// 브라우저 내장 음성 인식(Web Speech API). TS 기본 타입에 생성자가 없어 쓰는 만큼만 적는다
type Recognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    abort(): void;
};

function createRecognition(): Recognition | null {
    const w = window as unknown as Record<string, (new () => Recognition) | undefined>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    return Ctor ? new Ctor() : null;
}

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
    gate?: WakeGate;
    recognition?: Recognition;
    wakeLock?: WakeLockSentinel;
    raf?: number;
    nextTime: number;
    sources: Set<AudioBufferSourceNode>;
    active: boolean;
    awake: boolean;
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
    const [awake, setAwake] = useState(false);
    const [replying, setReplying] = useState(false);
    const [note, setNote] = useState<Note | null>(null);
    const orbRef = useRef<HTMLButtonElement>(null);
    const r = useRef<Refs>({
        nextTime: 0,
        sources: new Set(),
        active: false,
        awake: false,
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

    /** 불린 것을 알아들었다는 짧은 알림음 (화면을 보지 않으므로) */
    const beep = () => {
        const ctx = r.current.ctx;
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.06;
        osc.frequency.value = 880;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
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
            if (c.sources.size === 0) {
                setReplying(false);
                // 답이 끝난 뒤 이름 없이 이어 물을 수 있게 잠시 열어 둔다
                c.gate?.extend(Date.now(), FOLLOW_UP_MS);
            }
        };
    };

    // ---------- 호출 ----------
    const wakeUp = () => {
        if (r.current.gate?.wake(Date.now())) beep();
    };

    const startRecognition = () => {
        const c = r.current;
        const rec = createRecognition();
        if (!rec) {
            setNote({ text: `이 브라우저는 "${WAKE_NAME}" 호출을 알아듣지 못해요. 원을 눌러 말하세요.`, tone: "warn" });
            return;
        }
        rec.lang = "ko-KR";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (WAKE_PATTERN.test(e.results[i][0].transcript)) return wakeUp();
            }
        };
        rec.onerror = (e) => {
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                c.recognition = undefined;
                setNote({ text: `음성 인식 권한이 없어 "${WAKE_NAME}" 호출을 쓸 수 없어요. 원을 눌러 말하세요.`, tone: "warn" });
            }
        };
        // 브라우저 음성 인식은 조용하거나 오래되면 스스로 끝나므로 통화 중에는 다시 켠다
        rec.onend = () => {
            if (c.active && c.recognition === rec) {
                setTimeout(() => {
                    if (c.active && c.recognition === rec) {
                        try {
                            rec.start();
                        } catch {}
                    }
                }, 300);
            }
        };
        c.recognition = rec;
        try {
            rec.start();
        } catch {}
    };

    const stopRecognition = () => {
        const rec = r.current.recognition;
        r.current.recognition = undefined;
        if (!rec) return;
        rec.onend = null;
        try {
            rec.abort();
        } catch {}
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
        if (msg.toolCall) {
            // 도구 결과를 기다리는 동안 문이 닫혀 답이 끊기지 않게
            r.current.gate?.extend(Date.now(), FOLLOW_UP_MS);
            handleToolCall(msg.toolCall);
        }

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

        // 부르기 전에는 아무것도 보내지 않는다 (보내는 오디오 양이 곧 요금)
        const gate = new WakeGate({
            send: (chunk) => {
                try {
                    c.session?.sendRealtimeInput({ audio: { data: toBase64(chunk), mimeType: "audio/pcm;rate=16000" } });
                } catch {}
            },
            close: () => {
                try {
                    c.session?.sendRealtimeInput({ audioStreamEnd: true });
                } catch {}
            },
        });
        c.gate = gate;

        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-recorder");
        node.port.onmessage = (e) => {
            const level = rms(e.data);
            c.inLevel = level;
            gate.feed(e.data, level, Date.now(), c.sources.size > 0);
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
            if (gate.open !== c.awake) {
                c.awake = gate.open;
                setAwake(gate.open);
            }
            out.getFloatTimeDomainData(samples);
            let sum = 0;
            for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
            const level = c.sources.size > 0 ? Math.sqrt(sum / samples.length) : c.inLevel;
            orbRef.current?.style.setProperty("--level", Math.min(1, level * 6).toFixed(3));
            c.raf = requestAnimationFrame(loop);
        };
        c.raf = requestAnimationFrame(loop);
    };

    const teardownAudio = () => {
        const c = r.current;
        if (c.raf) cancelAnimationFrame(c.raf);
        orbRef.current?.style.setProperty("--level", "0");
        c.gate?.reset();
        c.node?.disconnect();
        c.stream?.getTracks().forEach((t) => t.stop());
        stopPlayback();
        c.ctx?.close().catch(() => {});
        Object.assign(c, { ctx: undefined, stream: undefined, node: undefined, out: undefined, gate: undefined, raf: undefined, inLevel: 0, awake: false });
        setAwake(false);
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
                    // 잘못 알아듣고 열렸을 때 주변 대화에는 답하지 않게
                    proactivity: { proactiveAudio: true },
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
        c.attempts = 0;
        setActive(true);
        setNeedTap(false);
        setNote(null);
        beginCall();
        try {
            setStatus("연결 중");
            stopRecognition();
            closeSession();
            teardownAudio();
            await setupAudio();
            await connectSession();
            startRecognition();
            await requestWakeLock();
        } catch (e) {
            c.active = false;
            setActive(false);
            stopRecognition();
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
        stopRecognition();
        closeSession();
        teardownAudio();
        releaseWakeLock();
        setStatus("");
        finishCall();
    };

    useEffect(() => {
        const refs = r.current;
        flushCalls(sendCall); // 지난번에 못 보낸 기록
        const onVisible = () => {
            if (document.visibilityState === "hidden") saveCall();
            if (document.visibilityState !== "visible" || !r.current.active) return;
            // 백그라운드에서 끝난 음성 인식을 다시 켠다 (이미 켜져 있으면 무시된다)
            try {
                r.current.recognition?.start();
            } catch {}
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

    const phase = !active || needTap ? "idle" : replying ? "replying" : awake ? "listening" : "standby";
    const label = {
        idle: needTap ? "눌러서 다시 시작" : "눌러서 통화 시작",
        standby: `"${WAKE_NAME}야" 하고 불러 주세요`,
        listening: "듣고 있어요",
        replying: "답하는 중",
    }[phase];
    const dot = { idle: "bg-gray-400", standby: "bg-green-600", listening: "bg-violet-600", replying: "bg-violet-600" }[phase];

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
                <button
                    ref={orbRef}
                    onClick={() => (phase === "idle" ? start() : wakeUp())}
                    aria-label={phase === "idle" ? label : "이름 없이 바로 말하기"}
                    data-phase={phase}
                    className="orb"
                >
                    <span className="orb-shape">
                        <span className="orb-fill" />
                    </span>
                </button>
                <p className="min-h-5 text-sm text-gray-600">{phase === "standby" ? "원을 누르면 이름 없이 바로 말할 수 있어요" : ""}</p>
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
