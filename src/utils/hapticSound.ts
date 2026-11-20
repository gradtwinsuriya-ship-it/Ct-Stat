let audioCtx: AudioContext | null = null;
let audioMuted = false;

export function setTactileAudioMuted(muted: boolean): void {
  audioMuted = muted;
}

export function isTactileAudioMuted(): boolean {
  return audioMuted;
}

/**
 * Procedural Web Audio tactile relay click (zero external audio asset files).
 * Respects mute flag and browser autoplay restrictions cleanly.
 */
export function playTactileSound(variant: 'click' | 'confirm' | 'alert' = 'click'): void {
  if (audioMuted || typeof window === 'undefined') return;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) {
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    if (variant === 'confirm') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.06);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.095);
    } else if (variant === 'alert') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.115);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.032);
      gain.gain.setValueAtTime(0.022, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  } catch {
    // Audio unavailable or blocked before gesture
  }
}

export type AnatomicalSoundRegion =
  | 'cortex'
  | 'ventricle'
  | 'lesion'
  | 'tract'
  | 'skull'
  | 'pin';

function ensureAudioContext(): AudioContext | null {
  if (audioMuted || typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Spatial harmonic chime tuned to specific cranial anatomy touched in 3D space.
 */
export function playAnatomicalChime(region: AnatomicalSoundRegion): void {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const baseFreqs: Record<AnatomicalSoundRegion, [number, number]> = {
      skull: [320, 480],
      cortex: [440, 660],
      ventricle: [528, 792],
      tract: [660, 990],
      lesion: [370, 554],
      pin: [740, 1108],
    };

    const [f1, f2] = baseFreqs[region];
    [f1, f2].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.03);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.04, now + 0.14 + idx * 0.04);
      gain.gain.setValueAtTime(idx === 0 ? 0.025 : 0.014, now + idx * 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22 + idx * 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.03);
      osc.stop(now + 0.28 + idx * 0.05);
    });
  } catch {
    // Ignore audio errors
  }
}

/**
 * Soft cardiac-like double pulse cue synced with volumetric analysis intensity.
 */
export function playTriagePulseBeat(intensity: number): void {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const clamped = Math.max(0.15, Math.min(1, intensity));
    const baseFreq = 165 + clamped * 140;

    [0, 0.14].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * (idx === 0 ? 1 : 1.18), now + offset);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, now + offset + 0.09);
      gain.gain.setValueAtTime((idx === 0 ? 0.022 : 0.015) * (0.6 + clamped * 0.6), now + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.12);
    });
  } catch {
    // Ignore audio errors
  }
}

