// ============================================================
// ADS MODULE
// Heute: Platzhalter-Overlays. Später: AdMob via Capacitor.
// ============================================================
const Ads = (() => {
  const MIN_INTERVAL_MS  = 5 * 60 * 1000; // min. 5 Min zwischen Ads
  const MIN_PLAYTIME_MS  = 3 * 60 * 1000; // erst nach 3 Min Spielzeit

  let lastShownAt    = 0;
  let trackingStart  = null;
  let accumulatedMs  = 0;

  // CSS injizieren
  const css = `
    .ad-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.88);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      padding: 16px;
    }
    .ad-card {
      background: #1e293b;
      border-radius: 16px;
      padding: 20px;
      width: min(340px, 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .ad-tag {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      align-self: flex-start;
    }
    .ad-placeholder {
      width: 100%;
      min-height: 200px;
      background: #0f172a;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #475569;
      font-size: 13px;
      border: 1px dashed #1e3a5f;
    }
    .ad-action-btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 12px 0;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    .ad-action-btn:disabled {
      background: #1e293b;
      color: #475569;
      cursor: default;
      border: 1px solid #334155;
    }
    .ad-rewarded-hint {
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
    }
    .ad-rewarded-reward {
      font-size: 15px;
      font-weight: 700;
      color: #f59e0b;
      text-align: center;
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Zeittracking ──────────────────────────────────────────

  function getActiveMs() {
    const extra = trackingStart ? Date.now() - trackingStart : 0;
    return accumulatedMs + extra;
  }

  function startTracking() {
    if (!trackingStart) trackingStart = Date.now();
  }

  function stopTracking() {
    if (trackingStart) {
      accumulatedMs += Date.now() - trackingStart;
      trackingStart = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTracking();
    else if (trackingStart === null && accumulatedMs > 0) startTracking();
  });

  // ── Interstitial ──────────────────────────────────────────

  function shouldShow() {
    if (getActiveMs() < MIN_PLAYTIME_MS) return false;
    if (Date.now() - lastShownAt < MIN_INTERVAL_MS) return false;
    return true;
  }

  function maybeInterstitial(onDone) {
    if (!shouldShow()) { onDone(); return; }
    lastShownAt = Date.now();

    const overlay = document.getElementById('ad-interstitial-overlay');
    if (!overlay) { onDone(); return; }

    overlay.style.display = 'flex';
    let sec = 5;
    const btn = overlay.querySelector('.ad-action-btn');
    btn.disabled = true;
    btn.textContent = `Schließen in ${sec}s`;

    const t = setInterval(() => {
      sec--;
      if (sec > 0) {
        btn.textContent = `Schließen in ${sec}s`;
      } else {
        clearInterval(t);
        btn.disabled = false;
        btn.textContent = 'Schließen ✕';
      }
    }, 1000);

    btn.onclick = () => {
      overlay.style.display = 'none';
      onDone();
    };
  }

  // ── Rewarded ──────────────────────────────────────────────

  function showRewarded(onRewarded) {
    const overlay = document.getElementById('ad-rewarded-overlay');
    if (!overlay) { onRewarded(); return; }

    overlay.style.display = 'flex';
    let sec = 15;
    const btn = overlay.querySelector('.ad-action-btn');
    btn.disabled = true;
    btn.textContent = `Noch ${sec} Sekunden…`;

    const t = setInterval(() => {
      sec--;
      if (sec > 0) {
        btn.textContent = `Noch ${sec} Sekunden…`;
      } else {
        clearInterval(t);
        btn.disabled = false;
        btn.textContent = '🎮 Nochmal spielen!';
      }
    }, 1000);

    btn.onclick = () => {
      overlay.style.display = 'none';
      onRewarded();
    };
  }

  return { startTracking, stopTracking, maybeInterstitial, showRewarded };
})();
