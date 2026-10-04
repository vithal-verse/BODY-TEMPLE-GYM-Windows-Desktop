"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "bodytemple:sound-enabled";
const PREFERENCE_EVENT = "bodytemple:sound-preference-changed";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

/** Keeps every mounted mute toggle in sync, even across multiple instances
 *  (desktop TopBar + mobile strip) without needing a context provider. */
export function useSoundEnabled() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    // Defaulting to `true` above keeps server and first-client-render HTML
    // identical (localStorage doesn't exist during SSR). This corrects it
    // to the real stored value right after mount — a standard, widely used
    // pattern for hydration-safe localStorage reads. The alternative (a
    // lazy useState initializer reading localStorage immediately) would
    // read a different value on the client than what the server rendered,
    // causing an actual hydration mismatch — a real bug, not just a lint
    // preference — so this is intentionally exempted from the stricter
    // no-synchronous-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(isSoundEnabled());
    function handleChange() {
      setEnabled(isSoundEnabled());
    }
    window.addEventListener(PREFERENCE_EVENT, handleChange);
    window.addEventListener("storage", handleChange);
    return () => {
      window.removeEventListener(PREFERENCE_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  return { enabled, toggle: () => setSoundEnabled(!enabled) };
}

/**
 * A brief, clean "tick" for check-ins — deliberately much shorter and
 * simpler than the clink or chime. This one fires dozens of times a day
 * at a busy front desk, so it needs to take up almost no auditory space:
 * a single short tone, no chord, no noise burst, done in well under
 * 150ms.
 */
export function playTick() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.08);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

/**
 * A short, bright, metallic "clink" — like a weight plate landing on a
 * bar. Synthesized directly rather than played from an audio file: no
 * asset to host or license to track, and it's easy to retune.
 */
export function playClink() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.22, now);
  masterGain.connect(ctx.destination);

  // Two slightly detuned oscillators for a metallic "beating" character.
  [980, 1013].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22 + i * 0.02);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  });

  // A brief burst of filtered noise for the initial "impact" transient.
  const bufferSize = Math.floor(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "highpass";
  noiseFilter.frequency.setValueAtTime(2000, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, now);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  noise.start(now);
}

/**
 * A soft, bell-like chime for a successful edit/renewal — longer and
 * gentler than the clink, closer to a notification "ding."
 */
export function playChime() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.16, now);
  masterGain.connect(ctx.destination);

  // Root + major third + fifth for a pleasant, resolved chime.
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);

    const gain = ctx.createGain();
    const start = now + i * 0.05;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.8, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.85);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(start);
    osc.stop(start + 0.9);
  });
}
