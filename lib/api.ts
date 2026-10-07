const API = process.env.NEXT_PUBLIC_API_URL;

export function getPasscode() {
    let p: string | null = null;
    try {
        p = localStorage.getItem("passcode");
    } catch {}
    if (!p) {
        p = prompt("접속 코드를 입력하세요") ?? "";
        try {
            localStorage.setItem("passcode", p);
        } catch {}
    }
    return p;
}

function clearPasscode() {
    try {
        localStorage.removeItem("passcode");
    } catch {}
}

export async function apiFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            ...(init.headers as Record<string, string> | undefined),
            "X-App-Passcode": getPasscode(),
        },
    });
    if (res.status === 401) {
        clearPasscode();
        throw new Error("접속 코드가 틀렸습니다. 새로고침 후 다시 입력하세요.");
    }
    if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
    return res;
}

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