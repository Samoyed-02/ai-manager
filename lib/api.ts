const API = process.env.NEXT_PUBLIC_API_URL;
const TOKEN_KEY = "token";

export class ApiError extends Error {
    status: number;
    code?: string;
    fields: Record<string, string>;
    retryAfterSeconds?: number;

    constructor(status: number, body: { error?: string; fields?: Record<string, string>; retryAfterSeconds?: number } = {}) {
        super(`요청 실패 (${status})`);
        this.status = status;
        this.code = body.error;
        this.fields = body.fields ?? {};
        this.retryAfterSeconds = body.retryAfterSeconds;
    }
}

async function toApiError(res: Response) {
    return new ApiError(res.status, await res.json().catch(() => undefined));
}

function getToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

function redirectToLogin() {
    try {
        localStorage.removeItem(TOKEN_KEY);
    } catch {}
    location.replace("/login");
    return new ApiError(401, { error: "unauthorized" });
}

/** 400의 fields 중 입력란이 있는 것은 fields로, 나머지(routine, goal 등 폼 전체 사유)와 그 밖의 오류는 form으로 나눈다 */
export function splitErrors(e: unknown, inputs: string[]) {
    if (!(e instanceof ApiError)) {
        const message = e instanceof TypeError ? "서버에 연결할 수 없습니다." : e instanceof Error ? e.message : String(e);
        return { fields: {} as Record<string, string>, form: message };
    }
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    for (const [key, message] of Object.entries(e.fields)) {
        if (inputs.includes(key)) fields[key] = message;
        else rest.push(message);
    }
    const fallback = Object.keys(fields).length > 0 ? "" : e.status === 400 ? "입력값을 확인해 주세요." : e.message;
    return { fields, form: rest.join(" ") || fallback };
}

export async function logout() {
    try {
        await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    throw redirectToLogin();
}

// apiFetch에 쓰면 비밀번호 오류의 401까지 로그인 화면 이동으로 처리되므로 따로 둔다
export async function login(body: { password: string; totp: string; deviceName?: string }) {
    const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw await toApiError(res);
    const { token } = await res.json();
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem("passcode"); // 예전 방식의 잔여 값
}

export async function authFetch(url: string, init: RequestInit = {}) {
    const token = getToken();
    if (!token) throw redirectToLogin();
    const res = await fetch(url, {
        ...init,
        headers: {
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
        },
    });
    if (res.status === 401) throw redirectToLogin();
    if (!res.ok) throw await toApiError(res);
    return res;
}

export const apiFetch = (path: string, init?: RequestInit) => authFetch(`${API}${path}`, init);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SseHandler = (event: string, data: any) => void;

export async function streamChat(
    body: { conversationId: string | null; message: string },
    onEvent: SseHandler,
) {
    const res = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);

            let event = "message";
            let data = "";
            for (const line of raw.split("\n")) {
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("data:")) data += line.slice(5);
            }
            if (data) onEvent(event, JSON.parse(data));
        }
    }
}