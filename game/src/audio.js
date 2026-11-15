// game/src/audio.js: synthesized, lazy WebAudio cues for combat and interface.
export function createAudio() {
  let context = null;
  let master = null;
  let isMuted = false;
  function ensureContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = isMuted ? 0 : 0.32;
      master.connect(context.destination);
      return context;
    } catch { return null; }
  }
  function tone(frequency, duration, type = 'sine', endFrequency = frequency, volume = 0.2, delay = 0) {
    const audio = ensureContext();
    if (!audio || isMuted) return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    } catch { /* Audio may be unavailable in headless or restricted contexts. */ }
  }
  function noise(duration, volume = 0.12, delay = 0) {
    const audio = ensureContext();
    if (!audio || isMuted) return;
    try {
      const length = Math.max(1, Math.floor(audio.sampleRate * duration));
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      const start = audio.currentTime + delay;
      source.buffer = buffer;
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      source.connect(gain);
      gain.connect(master);
      source.start(start);
    } catch { /* Audio may be unavailable in headless or restricted contexts. */ }
  }
  const sounds = {
    'shot-dibber': () => { noise(0.08, 0.22); tone(105, 0.13, 'triangle', 48, 0.22); },
    'shot-aphid': () => { noise(0.055, 0.18); tone(155, 0.1, 'square', 70, 0.13); },
    'shot-secateur': () => { noise(0.12, 0.26); tone(82, 0.2, 'sawtooth', 35, 0.26); },
    reload: () => { tone(720, 0.035, 'square', 300, 0.12); tone(520, 0.05, 'square', 220, 0.12, 0.16); },
    footstep: () => tone(90, 0.055, 'triangle', 42, 0.06),
    'plant-beep': () => tone(880, 0.09, 'sine', 680, 0.1),
    'defuse-beep': () => tone(620, 0.08, 'sine', 850, 0.1),
    horn: () => { tone(220, 0.55, 'sawtooth', 180, 0.12); tone(330, 0.55, 'sawtooth', 270, 0.08); },
    win: () => { tone(440, 0.35, 'triangle', 660, 0.12); tone(660, 0.5, 'triangle', 990, 0.12, 0.2); },
    lose: () => { tone(420, 0.5, 'triangle', 220, 0.14); tone(280, 0.6, 'sine', 110, 0.12, 0.18); },
    hit: () => tone(1150, 0.045, 'square', 850, 0.08),
    'grenade-pop': () => { noise(0.16, 0.3); tone(180, 0.45, 'sine', 900, 0.15, 0.03); },
    click: () => tone(700, 0.025, 'square', 480, 0.06),
    dryfire: () => tone(190, 0.035, 'square', 140, 0.08)
  };
  return {
    play(name, opts = {}) {
      const audio = ensureContext();
      if (!audio || isMuted) return;
      try { if (audio.state === 'suspended') audio.resume(); } catch { return; }
      const sound = sounds[name];
      if (sound) sound(opts);
    },
    setMuted(value) {
      isMuted = Boolean(value);
      if (master) master.gain.setTargetAtTime(isMuted ? 0 : 0.32, context.currentTime, 0.02);
    },
    get muted() { return isMuted; }
  };
}
