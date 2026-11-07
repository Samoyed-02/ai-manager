// "수피"를 부른 뒤에만 Gemini로 마이크 소리를 보내는 문. 보내는 오디오 양이 곧 요금이라 평소에는 닫아 둔다

/** 받아쓰기에서 호출어를 찾는다. "수피야", "수피 야", "슈피"처럼 받아 적혀도 인정한다 */
export const WAKE_PATTERN = /[수슈]\s?피/;

/** 호출 직후 말을 시작할 때까지 기다리는 시간 */
export const WAKE_OPEN_MS = 10_000;
/** AI 답이 끝난 뒤 이름 없이 이어 물을 수 있는 시간 */
export const FOLLOW_UP_MS = 8_000;
/** 말하는 동안에는 이만큼씩 계속 연다 (긴 질문이 중간에 잘리지 않게) */
const SPEAKING_HOLD_MS = 1_500;
const SPEAKING_LEVEL = 0.02;
/** 호출어를 알아듣기까지 걸리는 동안의 소리도 보내려고 담아 두는 조각 수 (조각당 0.1초) */
const PREROLL_CHUNKS = 25;

type Options = {
    send: (chunk: ArrayBuffer) => void;
    /** 문이 닫힐 때. 서버가 말 끝을 바로 알게 한다 */
    close: () => void;
};

export class WakeGate {
    private until = 0;
    private isOpen = false;
    private preroll: ArrayBuffer[] = [];
    private o: Options;

    constructor(o: Options) {
        this.o = o;
    }

    get open() {
        return this.isOpen;
    }

    /** 호출어나 버튼으로 연다. 닫혀 있다가 열렸으면 true (알림음용) */
    wake(now: number) {
        const wasClosed = !this.isOpen;
        this.extend(now, WAKE_OPEN_MS);
        return wasClosed;
    }

    extend(now: number, ms: number) {
        this.until = Math.max(this.until, now + ms);
    }

    /** 마이크 조각마다 부른다. replying: AI가 말하는 중이면 끼어들 수 있게 계속 보낸다 */
    feed(chunk: ArrayBuffer, level: number, now: number, replying: boolean) {
        if (this.isOpen && level > SPEAKING_LEVEL) this.extend(now, SPEAKING_HOLD_MS);
        if (now < this.until || replying) {
            if (!this.isOpen) {
                this.isOpen = true;
                this.preroll.forEach((c) => this.o.send(c));
                this.preroll = [];
            }
            this.o.send(chunk);
            return;
        }
        if (this.isOpen) {
            this.isOpen = false;
            this.o.close();
        }
        this.preroll.push(chunk);
        if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift();
    }

    reset() {
        this.until = 0;
        this.isOpen = false;
        this.preroll = [];
    }
}
