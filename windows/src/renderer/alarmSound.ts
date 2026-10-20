import type { AlarmSound } from "../core/alarm";

/**
 * The alarm's sounds, synthesised with WebAudio so no sound file ships: 종소리 (bell) a short bright
 * arpeggio every 1.6 s; 부드럽게 (soft) a lower two-note chime, quieter, every 2.4 s; 소리 없음 nothing.
 */
const voices: Record<Exclude<AlarmSound, "silent">, { notes: [number, number][]; level: number; attack: number; decay: number; period: number }> = {
  bell: { notes: [[1046.5, 0], [1318.5, 0.1], [1568, 0.2], [2093, 0.3]], level: 0.16, attack: 0.006, decay: 0.9, period: 1.6 },
  soft: { notes: [[392, 0], [523.25, 0.38]], level: 0.08, attack: 0.03, decay: 1.6, period: 2.4 },
};

/** One round of the sound starting at `at` (the context's time); returns how long a round lasts, in seconds. */
function play(context: AudioContext, sound: AlarmSound, at: number): number {
  if (sound === "silent") return 0;
  const voice = voices[sound];
  for (const [frequency, offset] of voice.notes) {
    // A bell-like tone: the note and a quiet inharmonic partial above it.
    for (const [multiple, share] of [[1, 1], [2.76, 0.22]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = at + offset;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * multiple;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(voice.level * share, start + voice.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.decay);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + voice.decay + 0.05);
    }
  }
  return voice.period;
}

/** ▶ 들어 보기: the sound once. */
export function previewSound(sound: AlarmSound): void {
  if (sound === "silent") return;
  const context = new AudioContext();
  const length = play(context, sound, context.currentTime + 0.03);
  window.setTimeout(() => void context.close(), (length + 1.2) * 1000);
}

/** The ring: the sound over and over until the returned function stops it. */
export function startRinging(sound: AlarmSound): () => void {
  if (sound === "silent") return () => undefined;
  const context = new AudioContext();
  void context.resume();
  let next = context.currentTime + 0.05;
  // Rounds are queued a little ahead on the audio clock, so a busy page never makes them stutter.
  const queue = () => {
    while (next < context.currentTime + 2) next += play(context, sound, next);
  };
  queue();
  const timer = window.setInterval(queue, 500);
  return () => {
    window.clearInterval(timer);
    void context.close();
  };
}
