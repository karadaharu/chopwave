import { type SampleBuffer, SLICE_COUNT } from '../audio/SampleBuffer';

interface Peak {
  min: number;
  max: number;
}

const COLORS = {
  background: '#111115',
  center: '#2a2a32',
  waveform: '#a6a6b2',
  waveformLoaded: '#f1f2f5',
  active: '#b9ff4a',
  marker: '#3d3d47',
  markerStrong: '#73737f',
} as const;

export class WaveformView {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private sample?: SampleBuffer;
  private activeSlices = new Set<number>();
  private peaks: Peak[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D is unavailable.');
    }

    this.context = context;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setSample(sample: SampleBuffer): void {
    this.sample = sample;
    this.rebuildPeaks();
    this.draw();
  }

  setActiveSlices(activeSlices: ReadonlySet<number>): void {
    this.activeSlices = new Set(activeSlices);
    this.draw();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.rebuildPeaks();
    }

    this.draw();
  }

  private rebuildPeaks(): void {
    if (!this.sample || this.canvas.width <= 0) {
      this.peaks = [];
      return;
    }

    const { audioBuffer } = this.sample;
    const peakCount = Math.min(this.canvas.width, 2400, audioBuffer.length);
    const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) =>
      audioBuffer.getChannelData(channel),
    );
    const peaks: Peak[] = [];

    for (let x = 0; x < peakCount; x += 1) {
      const start = Math.floor((x / peakCount) * audioBuffer.length);
      const end = Math.max(start + 1, Math.floor(((x + 1) / peakCount) * audioBuffer.length));
      let min = 1;
      let max = -1;

      for (let frame = start; frame < end; frame += 1) {
        let mixed = 0;
        for (const samples of channelData) {
          mixed += samples[frame] ?? 0;
        }
        mixed /= channelData.length;
        min = Math.min(min, mixed);
        max = Math.max(max, mixed);
      }

      peaks.push({ min, max });
    }

    this.peaks = peaks;
  }

  private draw(): void {
    const { width, height } = this.canvas;
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    if (this.activeSlices.size > 0) {
      ctx.fillStyle = `${COLORS.active}16`;
      for (const sliceIndex of this.activeSlices) {
        const x = (sliceIndex / SLICE_COUNT) * width;
        ctx.fillRect(x, 0, width / SLICE_COUNT, height);
      }
    }

    const centerY = height / 2;
    ctx.fillStyle = COLORS.center;
    ctx.fillRect(0, centerY, width, 1);

    if (this.peaks.length > 0) {
      const xScale = width / this.peaks.length;
      ctx.fillStyle = COLORS.waveformLoaded;
      for (let index = 0; index < this.peaks.length; index += 1) {
        const peak = this.peaks[index];
        if (!peak) continue;
        const y = centerY + peak.min * centerY * 0.82;
        const peakHeight = Math.max(1, (peak.max - peak.min) * centerY * 0.82);
        ctx.fillRect(index * xScale, y, Math.max(1, xScale), peakHeight);
      }
    } else {
      ctx.fillStyle = COLORS.waveform;
      ctx.fillRect(width * 0.16, centerY, width * 0.68, 1);
    }

    for (let index = 1; index < SLICE_COUNT; index += 1) {
      const x = Math.round((index / SLICE_COUNT) * width);
      ctx.fillStyle = index % 4 === 0 ? COLORS.markerStrong : COLORS.marker;
      ctx.fillRect(x, 0, index % 4 === 0 ? 2 : 1, height);
    }
  }
}
