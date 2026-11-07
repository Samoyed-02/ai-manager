import assert from "node:assert/strict";
import { test } from "node:test";
import { FOLLOW_UP_MS, WAKE_OPEN_MS, WAKE_PATTERN, WakeGate } from "./wake-gate.ts";

const setup = () => {
    const sent = [];
    let closes = 0;
    const gate = new WakeGate({ send: (c) => sent.push(c), close: () => closes++ });
    return { gate, sent, closes: () => closes };
};
const chunk = (n) => new Uint8Array([n]).buffer;
const ids = (sent) => sent.map((b) => new Uint8Array(b)[0]);

test("호출어: 받아쓰기 변형을 인정하고 비슷한 다른 말은 거른다", () => {
    for (const s of ["수피야 오늘 일정", "수피 야", "어 슈피야", "수 피야"]) assert.ok(WAKE_PATTERN.test(s), s);
    for (const s of ["스피커 켜줘", "수비 잘했어", "오늘 뭐 먹지"]) assert.ok(!WAKE_PATTERN.test(s), s);
});

test("부르기 전에는 아무것도 보내지 않는다", () => {
    const { gate, sent } = setup();
    for (let i = 0; i < 100; i++) gate.feed(chunk(i), 0.5, i * 100, false);
    assert.equal(sent.length, 0);
    assert.equal(gate.open, false);
});

test("부르면 직전 2.5초를 먼저 보내고 이어서 보낸다", () => {
    const { gate, sent } = setup();
    for (let i = 0; i < 30; i++) gate.feed(chunk(i), 0, i * 100, false);
    assert.equal(gate.wake(3000), true);
    gate.feed(chunk(30), 0, 3000, false);
    assert.deepEqual(ids(sent), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    assert.equal(gate.wake(3100), false); // 이미 열려 있으면 알림음 없음
});

test("부른 뒤 말이 없으면 10초 후 닫고 서버에 알린다", () => {
    const { gate, sent, closes } = setup();
    gate.wake(0);
    gate.feed(chunk(1), 0, WAKE_OPEN_MS - 1, false);
    assert.equal(gate.open, true);
    gate.feed(chunk(2), 0, WAKE_OPEN_MS, false);
    assert.equal(gate.open, false);
    assert.equal(closes(), 1);
    assert.deepEqual(ids(sent), [1]);
});

test("말하는 동안은 닫지 않는다", () => {
    const { gate } = setup();
    gate.wake(0);
    for (let t = 0; t <= 20_000; t += 100) gate.feed(chunk(0), 0.3, t, false);
    assert.equal(gate.open, true);
    gate.feed(chunk(0), 0, 21_600, false);
    assert.equal(gate.open, false);
});

test("AI가 말하는 중에는 열어 두고, 답이 끝나면 후속 질문 시간만큼 연다", () => {
    const { gate } = setup();
    gate.wake(0);
    gate.feed(chunk(0), 0, 30_000, true);
    assert.equal(gate.open, true);
    gate.extend(30_000, FOLLOW_UP_MS);
    gate.feed(chunk(0), 0, 30_000 + FOLLOW_UP_MS - 1, false);
    assert.equal(gate.open, true);
    gate.feed(chunk(0), 0, 30_000 + FOLLOW_UP_MS, false);
    assert.equal(gate.open, false);
});

test("reset은 담아 둔 소리도 버린다", () => {
    const { gate, sent } = setup();
    gate.feed(chunk(1), 0, 0, false);
    gate.reset();
    gate.wake(100);
    gate.feed(chunk(2), 0, 100, false);
    assert.deepEqual(ids(sent), [2]);
});
