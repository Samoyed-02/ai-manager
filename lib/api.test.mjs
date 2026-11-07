import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.NEXT_PUBLIC_API_URL = "http://api.test";
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
};
let redirects = [];
globalThis.location = { replace: (url) => redirects.push(url) };
const { apiFetch, ApiError, login } = await import("./api.ts");

const reply = (status, body) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
    };
    return calls;
};

beforeEach(() => {
    store.clear();
    redirects = [];
});

test("로그인 성공: 토큰을 저장하고 예전 패스코드를 지운다", async () => {
    store.set("passcode", "old");
    reply(200, { token: "t1", sessionId: "s", expiresAt: "e" });
    await login({ password: "p", totp: "123456" });
    assert.equal(store.get("token"), "t1");
    assert.equal(store.has("passcode"), false);
});

test("로그인 401: 로그인 화면으로 이동하지 않고 에러만 던진다", async () => {
    reply(401, { error: "invalid_credentials" });
    await assert.rejects(login({ password: "p", totp: "123456" }), (e) => e.code === "invalid_credentials");
    assert.deepEqual(redirects, []);
});

test("로그인 429: 본문의 retryAfterSeconds를 전달한다", async () => {
    reply(429, { error: "too_many_attempts", retryAfterSeconds: 42 });
    await assert.rejects(login({ password: "p", totp: "123456" }), (e) => e.retryAfterSeconds === 42);
});

test("apiFetch: Bearer만 붙이고 패스코드 헤더는 보내지 않는다", async () => {
    store.set("token", "t1");
    const calls = reply(200, {});
    await apiFetch("/tools", { headers: { "Content-Type": "application/json" } });
    assert.equal(calls[0].url, "http://api.test/tools");
    assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json", Authorization: "Bearer t1" });
});

test("apiFetch 401: 토큰을 지우고 로그인 화면으로 보낸다", async () => {
    store.set("token", "expired");
    reply(401, { error: "unauthorized" });
    await assert.rejects(apiFetch("/tools"), ApiError);
    assert.equal(store.has("token"), false);
    assert.deepEqual(redirects, ["/login"]);
});

test("apiFetch: 토큰이 없으면 요청 없이 로그인 화면으로 보낸다", async () => {
    const calls = reply(200, {});
    await assert.rejects(apiFetch("/tools"), ApiError);
    assert.equal(calls.length, 0);
    assert.deepEqual(redirects, ["/login"]);
});

test("apiFetch 400: fields를 전달하고 JSON이 아닌 본문도 처리한다", async () => {
    store.set("token", "t1");
    reply(400, { error: "invalid_request", fields: { content: "비어 있을 수 없습니다" } });
    await assert.rejects(apiFetch("/memories"), (e) => e.fields.content === "비어 있을 수 없습니다");
    globalThis.fetch = async () => new Response("oops", { status: 500 });
    await assert.rejects(apiFetch("/memories"), (e) => e.status === 500 && Object.keys(e.fields).length === 0);
});

test("splitErrors: 입력란 오류와 폼 전체 오류를 나눈다", async () => {
    const { splitErrors } = await import("./api.ts");
    const e = new ApiError(400, { error: "invalid_request", fields: { title: "필수", routine: "루틴은 최대 20개" } });
    assert.deepEqual(splitErrors(e, ["title"]), { fields: { title: "필수" }, form: "루틴은 최대 20개" });
    assert.deepEqual(splitErrors(new ApiError(400, {}), ["title"]), { fields: {}, form: "입력값을 확인해 주세요." });
    assert.deepEqual(splitErrors(new ApiError(500), []), { fields: {}, form: "요청 실패 (500)" });
    assert.equal(splitErrors(new TypeError("Failed to fetch"), []).form, "서버에 연결할 수 없습니다.");
    assert.deepEqual(splitErrors(new ApiError(400, { fields: { title: "필수" } }), ["title"]).form, "");
});
