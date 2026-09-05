import { AudioEngine } from '../audio/AudioEngine';
import { type SampleBuffer, SLICE_COUNT } from '../audio/SampleBuffer';
import { WaveformView } from './WaveformView';

const ACCEPTED_WAV_TYPES = new Set(['audio/wav', 'audio/wave', 'audio/x-wav']);

export class App {
  private readonly engine = new AudioEngine();
  private readonly waveform: WaveformView;
  private readonly pads: HTMLButtonElement[];
  private readonly fileInput: HTMLInputElement;
  private readonly dropZone: HTMLElement;
  private readonly fileName: HTMLElement;
  private readonly audioMeta: HTMLElement;
  private readonly status: HTMLElement;
  private readonly contextState: HTMLElement;
  private sample?: SampleBuffer;
  private dragDepth = 0;
  private playbackRatio = 1;
  private activeSliceIndex?: number;
  private triggerId = 0;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.template();

    this.fileInput = this.getElement<HTMLInputElement>('#file-input');
    this.dropZone = this.getElement<HTMLElement>('#drop-zone');
    this.fileName = this.getElement<HTMLElement>('#file-name');
    this.audioMeta = this.getElement<HTMLElement>('#audio-meta');
    this.status = this.getElement<HTMLElement>('#status');
    this.contextState = this.getElement<HTMLElement>('#context-state');
    this.pads = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.pad'));
    this.waveform = new WaveformView(this.getElement<HTMLCanvasElement>('#waveform'));

    this.bindEvents();
    this.renderLatency();
    this.renderAudioState();
  }

  private template(): string {
    const padMarkup = Array.from({ length: SLICE_COUNT }, (_, index) => {
      const padNumber = String(index + 1).padStart(2, '0');
      return `
        <button class="pad" type="button" data-slice="${index}" disabled aria-label="Play slice ${index + 1}">
          <span class="pad__index">${padNumber}</span>
          <span class="pad__time">—</span>
          <span class="pad__pulse" aria-hidden="true"></span>
        </button>`;
    }).join('');

    return `
      <main class="instrument">
        <header class="topbar">
          <div class="brand" aria-label="Chopwave">
            <span class="brand__mark" aria-hidden="true"></span>
            <span>CHOPWAVE</span>
            <span class="brand__version">MVP / 16</span>
          </div>
          <div class="file-info">
            <strong id="file-name">NO SAMPLE LOADED</strong>
            <span id="audio-meta">Drop a WAV to make it playable</span>
          </div>
          <button class="load-button" id="load-button" type="button">LOAD WAV</button>
          <input id="file-input" type="file" accept=".wav,audio/wav,audio/wave,audio/x-wav" hidden />
        </header>

        <div class="workspace">
          <section class="play-surface" aria-label="Sampler">
            <button class="waveform-panel" id="drop-zone" type="button" aria-label="Drop or choose a WAV file">
              <canvas id="waveform" aria-hidden="true"></canvas>
              <span class="drop-copy">
                <strong id="drop-title">DROP WAV</strong>
                <small id="status" aria-live="polite">16 equal slices. One instrument.</small>
              </span>
              <span class="waveform-label waveform-label--start">00:00.000</span>
              <span class="waveform-label waveform-label--end" id="duration-label">—</span>
            </button>

            <section class="pad-grid" aria-label="16 sample slices">
              ${padMarkup}
            </section>
          </section>

          <aside class="control-rail" aria-label="Audio controls and latency">
            <section class="length-control">
              <div class="section-label"><span>LENGTH</span><output id="length-value">—</output></div>
              <input id="slice-length" type="range" min="0.05" max="1" step="0.01" value="1" aria-label="Slice playback length" disabled />
              <div class="length-scale" aria-hidden="true"><span>FULL</span><span>5%</span></div>
            </section>

            <section class="latency-panel" aria-label="Audio latency">
              <div class="section-label"><span>AUDIO</span><span class="state-dot"></span></div>
              <dl>
                <div><dt>CONTEXT</dt><dd id="context-state">—</dd></div>
                <div><dt>RATE</dt><dd id="sample-rate">—</dd></div>
                <div><dt>BASE</dt><dd id="base-latency">—</dd></div>
                <div><dt>OUTPUT</dt><dd id="output-latency">—</dd></div>
              </dl>
            </section>
          </aside>
        </div>

        <footer class="footer">
          <span>POINTER DOWN / INSTANT TRIGGER</span>
          <span>MONOPHONIC CHOKE · 4ms ATTACK · 12ms RELEASE</span>
        </footer>
      </main>`;
  }

  private bindEvents(): void {
    const loadButton = this.getElement<HTMLButtonElement>('#load-button');
    loadButton.addEventListener('click', () => this.fileInput.click());
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.loadFile(file);
      this.fileInput.value = '';
    });

    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => event.preventDefault());
    this.dropZone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      this.dragDepth += 1;
      this.dropZone.classList.add('is-dragging');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dropZone.classList.remove('is-dragging');
    });
    this.dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      this.dragDepth = 0;
      this.dropZone.classList.remove('is-dragging');
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
        this.isWav(candidate),
      );

      if (file) {
        void this.loadFile(file);
      } else {
        this.showStatus('Drop a .wav file', true);
      }
    });

    for (const pad of this.pads) {
      pad.addEventListener(
        'pointerdown',
        (event) => {
          event.preventDefault();
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          const sliceIndex = Number(pad.dataset.slice);
          this.triggerPad(sliceIndex);
        },
        { passive: false },
      );
    }

    const sliceLength = this.getElement<HTMLInputElement>('#slice-length');
    sliceLength.addEventListener('input', () => {
      this.playbackRatio = Number(sliceLength.value);
      this.renderPlaybackLength();
    });

    this.engine.context.addEventListener('statechange', () => this.renderAudioState());
  }

  private async loadFile(file: File): Promise<void> {
    if (!this.isWav(file)) {
      this.showStatus('Only WAV files are supported in this MVP', true);
      return;
    }

    this.root.classList.add('is-loading');
    this.showStatus('Decoding audio…');
    this.engine.stop();
    this.triggerId += 1;
    this.activeSliceIndex = undefined;
    this.renderActiveSlice();

    try {
      await this.engine.resume();
      const sample = await this.engine.loadFile(file);
      this.sample = sample;
      this.waveform.setSample(sample);
      this.waveform.setActiveSlices(new Set());
      this.renderSample(sample);
      this.showStatus('Ready — hit a pad');
    } catch (error) {
      console.error(error);
      this.showStatus('Could not decode this WAV', true);
    } finally {
      this.root.classList.remove('is-loading');
      this.renderAudioState();
    }
  }

  private triggerPad(sliceIndex: number): void {
    if (!this.sample || !Number.isInteger(sliceIndex)) return;

    const triggerId = ++this.triggerId;
    this.activeSliceIndex = sliceIndex;
    this.renderActiveSlice();
    this.engine.triggerSlice(this.sample, sliceIndex, {
      durationRatio: this.playbackRatio,
      onEnded: () => this.endVoice(triggerId),
      onError: (error) => {
        console.error(error);
        this.endVoice(triggerId);
        this.showStatus('Audio is blocked — tap a pad again', true);
        this.renderAudioState();
      },
    });
  }

  private endVoice(triggerId: number): void {
    // Choked voices end later; their callbacks must not clear the newer pad's state.
    if (triggerId !== this.triggerId) return;
    this.activeSliceIndex = undefined;
    this.renderActiveSlice();
  }

  private renderSample(sample: SampleBuffer): void {
    this.fileName.textContent = sample.fileName.toUpperCase();
    this.audioMeta.textContent = `${sample.numberOfChannels === 1 ? 'MONO' : `${sample.numberOfChannels} CH`} · ${this.formatRate(sample.sampleRate)} · ${this.formatDuration(sample.duration)}`;
    this.getElement<HTMLElement>('#drop-title').textContent = 'DROP TO REPLACE';
    this.getElement<HTMLElement>('#duration-label').textContent = this.formatTimestamp(
      sample.duration,
    );
    this.getElement<HTMLInputElement>('#slice-length').disabled = false;
    this.renderPlaybackLength();

    for (const [index, pad] of this.pads.entries()) {
      pad.disabled = false;
      const time = pad.querySelector<HTMLElement>('.pad__time');
      const slice = sample.getSlice(index);
      if (time && slice) time.textContent = this.formatTimestamp(slice.startTime);
    }
  }

  private renderActiveSlice(): void {
    for (let index = 0; index < this.pads.length; index += 1) {
      const active = index === this.activeSliceIndex;
      this.pads[index]?.classList.toggle('is-active', active);
    }
    this.waveform.setActiveSlices(
      this.activeSliceIndex === undefined ? new Set() : new Set([this.activeSliceIndex]),
    );
  }

  private renderLatency(): void {
    const latency = this.engine.getLatencyInfo();
    this.getElement<HTMLElement>('#sample-rate').textContent = this.formatRate(latency.sampleRate);
    this.getElement<HTMLElement>('#base-latency').textContent = this.formatLatency(
      latency.baseLatency,
    );
    this.getElement<HTMLElement>('#output-latency').textContent =
      latency.outputLatency === undefined ? 'N/A' : this.formatLatency(latency.outputLatency);
  }

  private renderPlaybackLength(): void {
    const output = this.getElement<HTMLOutputElement>('#length-value');
    const slice = this.sample?.getSlice(0);
    output.value = slice ? this.formatPlaybackLength(slice.duration * this.playbackRatio) : '—';
  }

  private renderAudioState(): void {
    this.contextState.textContent = this.engine.context.state.toUpperCase();
    this.root.dataset.audioState = this.engine.context.state;
    this.renderLatency();
  }

  private showStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('is-error', isError);
  }

  private isWav(file: File): boolean {
    return file.name.toLowerCase().endsWith('.wav') || ACCEPTED_WAV_TYPES.has(file.type);
  }

  private formatRate(sampleRate: number): string {
    return `${(sampleRate / 1000).toFixed(1)} kHz`;
  }

  private formatLatency(seconds: number): string {
    return Number.isFinite(seconds) ? `${(seconds * 1000).toFixed(1)} ms` : 'N/A';
  }

  private formatDuration(seconds: number): string {
    return seconds < 60 ? `${seconds.toFixed(2)} SEC` : `${(seconds / 60).toFixed(2)} MIN`;
  }

  private formatPlaybackLength(seconds: number): string {
    return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
  }

  private formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(3).padStart(6, '0')}`;
  }

  private getElement<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
