// 통화 중 도구: GET /tools를 Gemini 함수 선언으로 등록하고, 호출은 POST /tools/{name}으로 중계한다
import type { FunctionDeclaration } from "@google/genai";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type ServerTool = { name: string; description: string; parameters: unknown };
type ToolCallResult = { ok: boolean; result: string | null; error: string | null; summary: string | null };

const LIST_RECENT_TASKS = "list_recent_tasks";

// 서버 /tools에 작업 조회 도구가 없어 프론트에서 GET /tasks로 처리한다
export const LOCAL_DECLARATIONS: FunctionDeclaration[] = [
    { name: LIST_RECENT_TASKS, description: "최근에 맡긴 작업들의 진행 상태를 확인한다." },
];

export async function loadDeclarations(api: ApiFetch): Promise<FunctionDeclaration[]> {
    const tools: ServerTool[] = await (await api("/tools")).json();
    return [
        ...tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })),
        ...LOCAL_DECLARATIONS,
    ];
}

/** response는 Gemini에 돌려줄 내용, note는 화면에 보여줄 한 줄 */
export async function runTool(
    api: ApiFetch,
    name: string,
    args: Record<string, unknown> = {},
): Promise<{ response: Record<string, unknown>; note?: string }> {
    if (name === LIST_RECENT_TASKS) {
        const list: { instruction: string; status: string }[] = await (await api("/tasks")).json();
        return {
            response: {
                tasks: list.slice(0, 5).map((t) => ({ instruction: t.instruction.slice(0, 60), status: t.status })),
            },
        };
    }

    const res = await api(`/tools/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
    });
    const out: ToolCallResult = await res.json();
    return out.ok
        ? { response: { result: out.result }, note: out.summary ?? undefined }
        : { response: { error: out.error }, note: out.error ?? undefined };
}
