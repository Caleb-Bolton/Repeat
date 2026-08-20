class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.state = 'idle';
    this.ring = new Float32Array(Math.max(1, Math.round(sampleRate * 0.3)));
    this.ringWriteIndex = 0;
    this.ringLength = 0;
    this.outputChunk = new Float32Array(2048);
    this.outputLength = 0;

    this.port.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'arm') {
        this.reset();
        this.state = 'armed';
      } else if (message.type === 'start' && this.state === 'armed') {
        this.startTake();
      } else if (message.type === 'stop' && this.state === 'recording') {
        this.finishTake();
      } else if (message.type === 'reset') {
        this.reset();
        this.state = 'idle';
      }
    };
  }

  reset() {
    this.ringWriteIndex = 0;
    this.ringLength = 0;
    this.outputLength = 0;
  }

  startTake() {
    const preRoll = new Float32Array(this.ringLength);
    const start = (this.ringWriteIndex - this.ringLength + this.ring.length) % this.ring.length;
    for (let i = 0; i < this.ringLength; i++) {
      preRoll[i] = this.ring[(start + i) % this.ring.length];
    }

    this.ringWriteIndex = 0;
    this.ringLength = 0;
    this.state = 'recording';
    this.port.postMessage(
      { type: 'take-start', samples: preRoll.buffer },
      [preRoll.buffer]
    );
  }

  flushOutput() {
    if (this.outputLength === 0) return;
    const samples = this.outputChunk.slice(0, this.outputLength);
    this.outputLength = 0;
    this.port.postMessage({ type: 'pcm', samples: samples.buffer }, [samples.buffer]);
  }

  finishTake() {
    this.flushOutput();
    this.state = 'idle';
    this.port.postMessage({ type: 'take-end' });
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const frameCount = channels[0].length;
    const channelCount = channels.length;
    for (let frame = 0; frame < frameCount; frame++) {
      let sample = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        sample += channels[channel][frame] || 0;
      }
      sample /= channelCount;

      if (this.state === 'armed') {
        this.ring[this.ringWriteIndex] = sample;
        this.ringWriteIndex = (this.ringWriteIndex + 1) % this.ring.length;
        this.ringLength = Math.min(this.ringLength + 1, this.ring.length);
      } else if (this.state === 'recording') {
        this.outputChunk[this.outputLength++] = sample;
        if (this.outputLength === this.outputChunk.length) this.flushOutput();
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
