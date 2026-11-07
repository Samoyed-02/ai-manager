import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
};
const { addFragment, beginCall, endCall, flushCalls, saveCall } = await import("./call-record.ts");

const recorder = () => {
    const sent = [];
    return { sent, send: async (call) => void sent.push(call) };
};
const pending = () => JSON.parse(store.get("pendingCalls") ?? "[]");

beforeEach(() => {
    endCall();
    store.clear();
});

test("조각을 이어 붙이고 역할이 바뀌면 나누며 빈 발화는 뺀다", async () => {
    beginCall();
    addFragment("user", "안녕");
    addFragment("user", "하세요 ");
    addFragment("assistant", "   ");
    addFragment("user", "네");
    addFragment("assistant", "반가워요");
    endCall();
    const { sent, send } = recorder();
    assert.equal(await flushCalls(send), null);
    assert.deepEqual(sent[0].turns, [
        { role: "user", text: "안녕하세요" },
        { role: "user", text: "네" },
        { role: "assistant", text: "반가워요" },
    ]);
    assert.ok(sent[0].startedAt && sent[0].endedAt);
    assert.equal(store.has("pendingCalls"), false);
});

test("발화가 없으면 보내지 않는다 (서버 최소 1개)", async () => {
    beginCall();
    endCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.equal(sent.length, 0);
});

test("5000자가 넘는 발화는 이모지를 깨지 않고 나눈다", async () => {
    beginCall();
    addFragment("user", "가".repeat(4999) + "😀" + "나");
    endCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    const parts = sent[0].turns.map((t) => t.text);
    assert.deepEqual(parts, ["가".repeat(4999), "😀나"]);
});

test("500개가 넘으면 나눠 보낸다", async () => {
    beginCall();
    for (let i = 0; i < 1100; i++) addFragment(i % 2 ? "assistant" : "user", "말");
    endCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.deepEqual(sent.map((c) => c.turns.length), [500, 500, 100]);
});

test("나눠 보내다 실패하면 남은 분량만 다시 보낸다", async () => {
    beginCall();
    for (let i = 0; i < 700; i++) addFragment(i % 2 ? "assistant" : "user", "말");
    endCall();
    let calls = 0;
    const flaky = async () => {
        if (++calls === 2) throw new Error("network");
    };
    assert.equal(await flushCalls(flaky), "retry");
    assert.equal(pending()[0].turns.length, 200);
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.deepEqual(sent.map((c) => c.turns.length), [200]);
});

test("400은 버리고 다음 기록을 계속 보낸다", async () => {
    store.set("pendingCalls", JSON.stringify([
        { startedAt: "a", turns: [{ role: "user", text: "나쁨" }] },
        { startedAt: "b", turns: [{ role: "user", text: "좋음" }] },
    ]));
    const sent = [];
    const result = await flushCalls(async (c) => {
        if (c.startedAt === "a") throw Object.assign(new Error(), { status: 400 });
        sent.push(c.startedAt);
    });
    assert.equal(result, "dropped");
    assert.deepEqual(sent, ["b"]);
    assert.equal(store.has("pendingCalls"), false);
});

test("401·5xx는 기록을 남긴다", async () => {
    beginCall();
    addFragment("user", "말");
    endCall();
    assert.equal(await flushCalls(async () => { throw Object.assign(new Error(), { status: 401 }); }), "retry");
    assert.equal(pending().length, 1);
});

test("겹쳐 호출해도 한 번만 보낸다", async () => {
    beginCall();
    addFragment("user", "말");
    endCall();
    const { sent, send } = recorder();
    await Promise.all([flushCalls(send), flushCalls(send)]);
    assert.equal(sent.length, 1);
});

test("진행 중인 통화는 보내지 않고, 탭이 죽어 남은 기록은 보낸다", async () => {
    beginCall();
    addFragment("user", "진행 중");
    saveCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.equal(sent.length, 0);
    assert.equal(pending().length, 1);
    endCall();
    await flushCalls(send);
    assert.equal(sent.length, 1);
});

test("다른 탭이 보내고 지운 기록을 메모리 사본으로 다시 보내지 않는다", async () => {
    beginCall();
    addFragment("user", "말");
    endCall();
    store.clear(); // 다른 탭이 전송 후 삭제
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.equal(sent.length, 0);
});

// 모듈이 메모리 전용으로 바뀌므로 마지막에 둔다
test("localStorage를 못 써도 메모리로 전송한다", async () => {
    const original = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error("quota"); };
    beginCall();
    addFragment("user", "말");
    endCall();
    globalThis.localStorage.setItem = original;
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.equal(sent.length, 1);
});
