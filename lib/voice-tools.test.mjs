import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDeclarations, LOCAL_DECLARATIONS, runTool } from "./voice-tools.ts";

const stub = (body) => {
    const calls = [];
    const api = async (path, init) => {
        calls.push({ path, init });
        return new Response(JSON.stringify(body));
    };
    return { api, calls };
};

test("서버 도구를 함수 선언으로 바꾸고 작업 조회 도구를 더한다", async () => {
    const parameters = { type: "object", properties: {}, required: [] };
    const { api } = stub([{ name: "list_goals", description: "목표", parameters }]);
    const list = await loadDeclarations(api);
    assert.deepEqual(list[0], { name: "list_goals", description: "목표", parametersJsonSchema: parameters });
    assert.deepEqual(list.slice(1), LOCAL_DECLARATIONS);
});

test("성공: POST /tools/{name} {args}로 중계하고 result와 summary를 나눈다", async () => {
    const { api, calls } = stub({ ok: true, result: "{}", error: null, summary: "기록함" });
    const out = await runTool(api, "log_activity", { description: "공부" });
    assert.equal(calls[0].path, "/tools/log_activity");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { args: { description: "공부" } });
    assert.deepEqual(out, { response: { result: "{}" }, note: "기록함" });
});

test("summary가 없는 조회는 화면에 표시하지 않는다", async () => {
    const { api } = stub({ ok: true, result: "[]", error: null, summary: null });
    assert.equal((await runTool(api, "list_goals")).note, undefined);
});

test("인자가 없으면 빈 args를 보낸다", async () => {
    const { api, calls } = stub({ ok: true, result: "[]", error: null, summary: null });
    await runTool(api, "list_routines");
    assert.deepEqual(JSON.parse(calls[0].init.body), { args: {} });
});

test("ok=false: 사유를 Gemini에 돌려주고 화면에도 표시한다", async () => {
    const { api } = stub({ ok: false, result: null, error: "title 은(는) 필수야.", summary: null });
    assert.deepEqual(await runTool(api, "create_goal"), {
        response: { error: "title 은(는) 필수야." },
        note: "title 은(는) 필수야.",
    });
});

test("도구 이름을 경로에 그대로 넣지 않는다", async () => {
    const { api, calls } = stub({ ok: true, result: "", error: null, summary: null });
    await runTool(api, "../auth/logout");
    assert.equal(calls[0].path, "/tools/..%2Fauth%2Flogout");
});

test("list_recent_tasks는 GET /tasks 최근 5개로 처리한다", async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ instruction: "가".repeat(100), status: `S${i}` }));
    const { api, calls } = stub(tasks);
    const { response } = await runTool(api, "list_recent_tasks");
    assert.equal(calls[0].path, "/tasks");
    assert.equal(response.tasks.length, 5);
    assert.equal(response.tasks[0].instruction.length, 60);
});

test("HTTP 오류는 호출한 쪽에서 처리하도록 그대로 던진다", async () => {
    await assert.rejects(runTool(async () => { throw new Error("요청 실패 (404)"); }, "nope"), /404/);
});
