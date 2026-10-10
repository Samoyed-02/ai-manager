export type TurnState = "idle" | "armed" | "speaking";

type Options = {
    onStart: () => void;
    onAudio: (buf: ArrayBuffer) => void;
    onEnd: () => void;
    onState: (s: TurnState) => void;
};

const CHUNK_MS = 100;
const THRESHOLD = 0.02;
const SILENCE_MS = 900;
const PREROLL_CHUNKS = 3;

function rms(buf: ArrayBuffer) {
    const a = new Int16Array(buf);
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const v = a[i] / 32768;
        sum += v * v;
    }
    return Math.sqrt(sum / Math.max(1, a.length));
}

export class TurnController {
    state: TurnState = "idle";
    private preroll: ArrayBuffer[] = [];
    private silentMs = 0;
    private armTimer?: ReturnType<typeof setTimeout>;

    constructor(private o: Options) {}

    arm(windowMs: number) {
        if (this.state === "speaking") return;
        clearTimeout(this.armTimer);
        this.preroll = [];
        this.set("armed");
        this.armTimer = setTimeout(() => {
            if (this.state === "armed") this.set("idle");
        }, windowMs);
    }

    disarm() {
        clearTimeout(this.armTimer);
        if (this.state === "speaking") this.o.onEnd();
        this.preroll = [];
        this.set("idle");
    }

    feed(buf: ArrayBuffer) {
        if (this.state === "idle") return;
        const level = rms(buf);

        if (this.state === "armed") {
            this.preroll.push(buf);
            if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift();
            if (level > THRESHOLD) {
                clearTimeout(this.armTimer);
                this.silentMs = 0;
                this.set("speaking");
                this.o.onStart();
                this.preroll.forEach((b) => this.o.onAudio(b));
                this.preroll = [];
            }
            return;
        }

        this.o.onAudio(buf);
        this.silentMs = level > THRESHOLD ? 0 : this.silentMs + CHUNK_MS;
        if (this.silentMs >= SILENCE_MS) {
            this.o.onEnd();
            this.set("idle");
        }
    }

    private set(s: TurnState) {
        this.state = s;
        this.o.onState(s);
    }
}