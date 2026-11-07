// 통화 기록을 모아 POST /voice/calls로 보낸다. 토큰 만료·탭 종료에도 남도록 전송 전까지 localStorage에 둔다
export type Turn = { role: "user" | "assistant"; text: string };
export type CallRecord = { startedAt: string; endedAt?: string; turns: Turn[] };
export type FlushResult = "retry" | "dropped" | null;
type Send = (call: CallRecord) => Promise<unknown>;

const KEY = "pendingCalls";
// 서버 제한: voice/VoiceCallController.kt
const MAX_TURNS = 500;
const MAX_TEXT = 5000;
// 이만큼 쉬었다 이어진 사용자 말은 다른 발화로 본다 (주변 대화와 호출을 나누려고)
const USER_GAP_MS = 2000;

let active: CallRecord | null = null;
let memory: CallRecord[] = []; // localStorage를 못 쓸 때의 대체 보관소
let memoryOnly = false;
let queue: Promise<FlushResult> = Promise.resolve(null);
let open = false; // 마지막 발화에 이어 붙일 수 있는지
let lastAt = 0;

// 비어 있는 localStorage는 "보낼 것 없음"이다. memory로 대신하면 다른 탭이 이미 보낸 기록을 다시 보낸다
function read(): CallRecord[] {
    if (memoryOnly) return memory;
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return memory;
    }
}

function write(calls: CallRecord[]) {
    memory = calls;
    if (memoryOnly) return;
    try {
        if (calls.length) localStorage.setItem(KEY, JSON.stringify(calls));
        else localStorage.removeItem(KEY);
    } catch {
        // 용량 초과 등. 옛 값이 남지 않게 지우고 이후로는 memory만 쓴다
        memoryOnly = true;
        try {
            localStorage.removeItem(KEY);
        } catch {}
    }
}

function splitText(text: string) {
    const parts: string[] = [];
    let rest = text.trim();
    while (rest.length > MAX_TEXT) {
        const code = rest.charCodeAt(MAX_TEXT - 1);
        const cut = code >= 0xd800 && code <= 0xdbff ? MAX_TEXT - 1 : MAX_TEXT; // 이모지 중간에서 자르지 않는다
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    parts.push(rest);
    return parts.filter((p) => p.trim());
}

/**
 * 마이크가 늘 켜져 있어 주변 말도 받아 적힌다. AI가 바로 답한 사용자 발화만 남겨
 * 호출하지 않은 대화가 기록·기억에 들어가지 않게 한다
 */
function normalize(turns: Turn[]) {
    return turns
        .filter((t) => t.text.trim())
        .filter((t, i, all) => t.role === "assistant" || all[i + 1]?.role === "assistant")
        .flatMap((t) => splitText(t.text).map((text) => ({ role: t.role, text })));
}

function replace(startedAt: string, call?: CallRecord) {
    const others = read().filter((c) => c.startedAt !== startedAt);
    write(call ? [...others, call] : others);
}

/** 다시 시작(재연결 실패 후 탭)은 같은 통화로 이어 간다 */
export function beginCall() {
    active ??= { startedAt: new Date().toISOString(), turns: [] };
}

/** 받아쓰기 조각을 이어 붙인다. 역할이 바뀌거나, breakTurn 뒤거나, 사용자 말이 한동안 끊겼으면 새 발화로 나눈다 */
export function addFragment(role: Turn["role"], text: string, now = Date.now()) {
    if (!active) return;
    const last = active.turns[active.turns.length - 1];
    const continues = open && last?.role === role && (role === "assistant" || now - lastAt < USER_GAP_MS);
    if (continues) last.text += text;
    else active.turns.push({ role, text });
    open = true;
    lastAt = now;
}

/** AI 답변이 끝나거나 끊기면 다음 조각은 새 발화로 시작한다 */
export function breakTurn() {
    open = false;
}

export function saveCall() {
    if (active && normalize(active.turns).length > 0) replace(active.startedAt, active);
}

export function endCall() {
    if (!active) return;
    active.endedAt = new Date().toISOString();
    saveCall();
    active = null;
    open = false;
}

async function run(send: Send): Promise<FlushResult> {
    let result: FlushResult = null;
    for (const call of read()) {
        if (call.startedAt === active?.startedAt) continue;
        let rest = normalize(call.turns);
        try {
            // 나눠 보내다 실패해도 이미 보낸 부분을 다시 보내지 않도록 매번 남은 분량을 저장한다
            while (rest.length > 0) {
                await send({ ...call, turns: rest.slice(0, MAX_TURNS) });
                rest = rest.slice(MAX_TURNS);
                replace(call.startedAt, { ...call, turns: rest });
            }
            replace(call.startedAt);
        } catch (e) {
            if ((e as { status?: number }).status !== 400) return "retry";
            // 400은 다시 보내도 실패하므로 버린다
            replace(call.startedAt);
            result = "dropped";
        }
    }
    return result;
}

/** 저장된 기록을 차례로 보낸다. 겹쳐 호출해도 줄을 세워 중복 전송하지 않는다 */
export function flushCalls(send: Send) {
    queue = queue.then(() => run(send));
    return queue;
}
