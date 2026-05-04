// Web Audio Sound System – kein externe Dateien nötig
const SoundSystem = (() => {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function tone(freq, start, dur, vol, type = 'sine', dest) {
    const c = getCtx();
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.015);
    g.gain.setValueAtTime(vol * 0.75, start + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest || c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  function startBgMusic() {}
  function stopBgMusic() {}
  function playTick() {}

  // ── Antwort-Sounds ────────────────────────────────────────────────
  function playCorrect() {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime;
    tone(523.25, t,        0.12, 0.28, 'sine');
    tone(659.25, t + 0.10, 0.12, 0.28, 'sine');
    tone(783.99, t + 0.20, 0.22, 0.28, 'sine');
  }

  function playWrong() {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime;
    tone(220, t,        0.14, 0.22, 'sawtooth');
    tone(196, t + 0.12, 0.24, 0.18, 'sawtooth');
  }

  // ── Streak-Sound (alle 5er) ────────────────────────────────────────
  function playStreak() {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((f, i) => {
      tone(f, t + i * 0.07, 0.18, 0.3, 'sine');
    });
  }

  // ── Mute-Toggle ───────────────────────────────────────────────────
  function toggleMute() {
    muted = !muted;
    return muted;
  }

  function isMuted() { return muted; }

  function _resumeCtx() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
  }

  return { startBgMusic, stopBgMusic, playCorrect, playWrong, playTick, playStreak, toggleMute, isMuted, _resumeCtx };
})();
