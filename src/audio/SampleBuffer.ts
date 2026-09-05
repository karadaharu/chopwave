export const SLICE_COUNT = 16;

export interface SliceRegion {
  index: number;
  startTime: number;
  duration: number;
}

export class SampleBuffer {
  readonly fileName: string;
  readonly audioBuffer: AudioBuffer;
  readonly slices: readonly SliceRegion[];

  constructor(fileName: string, audioBuffer: AudioBuffer) {
    this.fileName = fileName;
    this.audioBuffer = audioBuffer;

    const sliceDuration = audioBuffer.duration / SLICE_COUNT;
    this.slices = Array.from({ length: SLICE_COUNT }, (_, index) => ({
      index,
      startTime: index * sliceDuration,
      duration: sliceDuration,
    }));
  }

  get duration(): number {
    return this.audioBuffer.duration;
  }

  get sampleRate(): number {
    return this.audioBuffer.sampleRate;
  }

  get numberOfChannels(): number {
    return this.audioBuffer.numberOfChannels;
  }

  getSlice(index: number): SliceRegion | undefined {
    return this.slices[index];
  }
}
