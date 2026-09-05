import { SampleBuffer } from './SampleBuffer';

const ATTACK_SECONDS = 0.004;
const RELEASE_SECONDS = 0.012;
const CHOKE_RELEASE_SECONDS = 0.004;

interface ActiveVoice {
  envelope: GainNode;
  source: AudioBufferSourceNode;
}

export interface LatencyInfo {
  sampleRate: number;
  baseLatency: number;
  outputLatency?: number;
}

export type VoiceEndedCallback = (sliceIndex: number) => void;
export type VoiceErrorCallback = (error: unknown) => void;

export interface TriggerOptions {
  durationRatio?: number;
  onEnded?: VoiceEndedCallback;
  onError?: VoiceErrorCallback;
}

export class AudioEngine {
  readonly context: AudioContext;

  private readonly masterGain: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private activeVoice?: ActiveVoice;
  private triggerRequestId = 0;

  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.masterGain = this.context.createGain();
    this.limiter = this.context.createDynamicsCompressor();

    this.masterGain.gain.value = 0.85;

    // A fast, high-ratio compressor is the final safety stage for transient peaks.
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;

    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.context.destination);
  }

  async loadFile(file: File): Promise<SampleBuffer> {
    const data = await file.arrayBuffer();
    // decodeAudioData copies/decodes into an AudioBuffer owned by this AudioContext.
    const audioBuffer = await this.context.decodeAudioData(data);

    if (audioBuffer.duration <= 0 || audioBuffer.length === 0) {
      throw new Error('The WAV contains no playable audio.');
    }

    return new SampleBuffer(file.name, audioBuffer);
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  triggerSlice(sample: SampleBuffer, sliceIndex: number, options: TriggerOptions = {}): void {
    const durationRatio = Math.min(1, Math.max(0.01, options.durationRatio ?? 1));
    const requestId = ++this.triggerRequestId;
    this.chokeActiveVoice();

    if (this.context.state !== 'running') {
      // The first gesture unlocks audio; subsequent hits stay on the synchronous fast path.
      void this.resume()
        .then(() => {
          // If another pad was hit while resume() was pending, only the newest request may sound.
          if (requestId === this.triggerRequestId) {
            this.startVoice(sample, sliceIndex, durationRatio, options.onEnded);
          }
        })
        .catch((error: unknown) => options.onError?.(error));
      return;
    }

    try {
      this.startVoice(sample, sliceIndex, durationRatio, options.onEnded);
    } catch (error) {
      options.onError?.(error);
    }
  }

  stop(): void {
    this.triggerRequestId += 1;
    this.chokeActiveVoice();
  }

  getLatencyInfo(): LatencyInfo {
    const outputLatency = this.context.outputLatency;

    return {
      sampleRate: this.context.sampleRate,
      baseLatency: this.context.baseLatency,
      ...(Number.isFinite(outputLatency) ? { outputLatency } : {}),
    };
  }

  private startVoice(
    sample: SampleBuffer,
    sliceIndex: number,
    durationRatio: number,
    onEnded?: VoiceEndedCallback,
  ): void {
    const slice = sample.getSlice(sliceIndex);
    if (!slice) {
      return;
    }

    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const now = this.context.currentTime;
    const playbackDuration = slice.duration * durationRatio;
    const attack = Math.min(ATTACK_SECONDS, playbackDuration * 0.25);
    const release = Math.min(RELEASE_SECONDS, playbackDuration * 0.35);
    const releaseStart = Math.max(attack, playbackDuration - release);

    source.buffer = sample.audioBuffer;

    // A GainNode per hit keeps voices independent and softens hard slice boundaries.
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + attack);
    envelope.gain.setValueAtTime(1, now + releaseStart);
    envelope.gain.linearRampToValueAtTime(0, now + playbackDuration);

    source.connect(envelope);
    envelope.connect(this.masterGain);
    this.activeVoice = { source, envelope };

    source.addEventListener(
      'ended',
      () => {
        if (this.activeVoice?.source === source) {
          this.activeVoice = undefined;
        }
        source.disconnect();
        envelope.disconnect();
        onEnded?.(sliceIndex);
      },
      { once: true },
    );

    // Every trigger receives a fresh source: AudioBufferSourceNode is intentionally one-shot.
    source.start(now, slice.startTime, playbackDuration);
  }

  private chokeActiveVoice(): void {
    const voice = this.activeVoice;
    if (!voice) return;

    this.activeVoice = undefined;
    const now = this.context.currentTime;

    // A tiny choke fade preserves the immediate monophonic feel without a hard-stop click.
    voice.envelope.gain.cancelAndHoldAtTime(now);
    voice.envelope.gain.linearRampToValueAtTime(0, now + CHOKE_RELEASE_SECONDS);
    voice.source.stop(now + CHOKE_RELEASE_SECONDS);
  }
}
