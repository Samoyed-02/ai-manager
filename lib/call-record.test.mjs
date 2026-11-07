import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
};
const { addFragment, beginCall, breakTurn, endCall, flushCalls, saveCall } = await import("./call-record.ts");

const recorder = () => {
    const sent = [];
    return { sent, send: async (call) => void sent.push(call) };
};
const pending = () => JSON.parse(store.get("pendingCalls") ?? "[]");

beforeEach(() => {
    endCall();
    store.clear();
});

test("조각을 이어 붙이고, AI가 답한 사용자 발화만 남긴다", async () => {
    beginCall();
    addFragment("user", "어제 그 드라마 ", 0); // 주변 대화
    addFragment("user", "봤어?", 500);
    addFragment("user", "수피야 오늘 ", 5000); // 2초 넘게 쉬고 호출
    addFragment("user", "일정 알려줘", 5600);
    addFragment("assistant", "오늘은 ", 6000);
    addFragment("assistant", "일정이 없어요", 6200);
    breakTurn();
    addFragment("assistant", "   ", 7000);
    addFragment("user", "고마워", 9000); // 답이 없었던 마지막 말
    endCall();
    const { sent, send } = recorder();
    assert.equal(await flushCalls(send), null);
    assert.deepEqual(sent[0].turns, [
        { role: "user", text: "수피야 오늘 일정 알려줘" },
        { role: "assistant", text: "오늘은 일정이 없어요" },
    ]);
    assert.ok(sent[0].startedAt && sent[0].endedAt);
    assert.equal(store.has("pendingCalls"), false);
});

test("AI 답변이 끝나면 다음 답변은 새 발화로 나눈다", async () => {
    beginCall();
    addFragment("user", "수피야 하나", 0);
    addFragment("assistant", "첫 답", 100);
    breakTurn();
    addFragment("assistant", "둘째 답", 200);
    endCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.deepEqual(sent[0].turns.map((t) => t.text), ["수피야 하나", "첫 답", "둘째 답"]);
});

test("아무도 수피를 부르지 않은 통화는 저장하지 않는다", async () => {
    beginCall();
    addFragment("user", "주변 대화만 있었다");
    endCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.equal(sent.length, 0);
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
    addFragment("assistant", "네");
    endCall();
    const { sent, send } = recorder();
    await flushCalls(send);
    const parts = sent[0].turns.filter((t) => t.role === "user").map((t) => t.text);
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
        { startedAt: "a", turns: [{ role: "assistant", text: "나쁨" }] },
        { startedAt: "b", turns: [{ role: "assistant", text: "좋음" }] },
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
    addFragment("assistant", "네");
    endCall();
    assert.equal(await flushCalls(async () => { throw Object.assign(new Error(), { status: 401 }); }), "retry");
    assert.equal(pending().length, 1);
});

test("겹쳐 호출해도 한 번만 보낸다", async () => {
    beginCall();
    addFragment("user", "말");
    addFragment("assistant", "네");
    endCall();
    const { sent, send } = recorder();
    await Promise.all([flushCalls(send), flushCalls(send)]);
    assert.equal(sent.length, 1);
});

test("진행 중인 통화는 보내지 않고, 탭이 죽어 남은 기록은 보낸다", async () => {
    beginCall();
    addFragment("user", "진행 중");
    addFragment("assistant", "네");
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
    addFragment("assistant", "네");
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
    addFragment("assistant", "네");
    endCall();
    globalThis.localStorage.setItem = original;
    const { sent, send } = recorder();
    await flushCalls(send);
    assert.equal(sent.length, 1);
});
