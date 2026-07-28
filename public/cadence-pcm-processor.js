class CadencePcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate =
      options.processorOptions?.targetSampleRate ?? 16000;
    this.frameDurationSeconds =
      options.processorOptions?.frameDurationSeconds ?? 0.1;
    this.sourceFrameSize = Math.max(
      128,
      Math.round(sampleRate * this.frameDurationSeconds),
    );
    this.pending = [];
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      this.pending.push(channel[index]);
    }

    while (this.pending.length >= this.sourceFrameSize) {
      const source = this.pending.splice(0, this.sourceFrameSize);
      const outputLength = Math.max(
        1,
        Math.round(
          source.length * (this.targetSampleRate / sampleRate),
        ),
      );
      const pcm = new Int16Array(outputLength);
      const ratio = source.length / outputLength;

      for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const sourcePosition = outputIndex * ratio;
        const lowerIndex = Math.floor(sourcePosition);
        const upperIndex = Math.min(source.length - 1, lowerIndex + 1);
        const fraction = sourcePosition - lowerIndex;
        const sample =
          source[lowerIndex] * (1 - fraction) +
          source[upperIndex] * fraction;
        const bounded = Math.max(-1, Math.min(1, sample));
        pcm[outputIndex] =
          bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff;
      }

      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('cadence-pcm-processor', CadencePcmProcessor);
