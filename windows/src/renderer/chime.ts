/** A soft two-note glass chime, synthesised so no sound file ships (the timer's board and the focus card). */
export function chime(): void {
  const context = new AudioContext();
  const start = context.currentTime + 0.02;
  for (const [frequency, at] of [[1046.5, 0], [1568, 0.16]] as const) {
    for (const [multiple, level] of [[1, 0.16], [2.76, 0.035]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * multiple;
      gain.gain.setValueAtTime(0, start + at);
      gain.gain.linearRampToValueAtTime(level, start + at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 1.4);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + 1.5);
    }
  }
  window.setTimeout(() => void context.close(), 2200);
}
