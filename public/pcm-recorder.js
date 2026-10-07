class PcmRecorder extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ratio = sampleRate / 16000;
        this.pos = 0;
        this.out = [];
    }

    process(inputs) {
        const input = inputs[0]?.[0];
        if (input) {
            while (this.pos < input.length) {
                const s = Math.max(-1, Math.min(1, input[Math.floor(this.pos)]));
                this.out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
                this.pos += this.ratio;
            }
            this.pos -= input.length;

            if (this.out.length >= 1600) {
                const pcm = Int16Array.from(this.out);
                this.port.postMessage(pcm.buffer, [pcm.buffer]);
                this.out = [];
            }
        }
        return true;
    }
}

registerProcessor("pcm-recorder", PcmRecorder);