// Wettkampf-Modus: 15 Fragen, Timer, Punkte → automatisch in Rangliste speichern

const PENDING_KEY = 'quiz_pending_wettkampf';
const PENDING_MAX_ENTRIES = 20;
const PENDING_MAX_AGE_DAYS = 30;

function loadPending() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
  catch { raw = []; }
  // Älter als 30 Tage rauswerfen
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PENDING_MAX_AGE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return raw.filter(e => e.played_date >= cutoffStr);
}

function savePending(list) {
  // Auf Max begrenzen — neueste behalten
  const trimmed = list.slice(-PENDING_MAX_ENTRIES);
  localStorage.setItem(PENDING_KEY, JSON.stringify(trimmed));
}

function queuePendingResult(entry) {
  const pending = loadPending();
  pending.push(entry);
  savePending(pending);
}

async function flushPendingResults() {
  const pending = loadPending();
  if (pending.length === 0) {
    savePending(pending);
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    savePending(pending);
    return;
  }

  // Gamertag immer aus Session-Metadaten — nicht aus Pending-Eintrag vertrauen
  const sessionGamertag = session.user?.user_metadata?.gamertag
    || localStorage.getItem(STORAGE.GAMERTAG)
    || '';

  const remaining = [];
  for (const entry of pending) {
    try {
      const { error } = await sb.from('wettkampf_history').insert({
        ...entry,
        gamertag: sessionGamertag,
        user_id: session.user.id,
      });
      if (error) remaining.push(entry);
    } catch (e) {
      console.error('Pending-Flush Fehler:', e);
      remaining.push(entry);
    }
  }
  savePending(remaining);
}

async function saveWettkampfHistory(score, correct, wrong) {
  let session = null;
  try {
    const { data: { session: s } } = await sb.auth.getSession();
    session = s;
  } catch (_) {}

  // Gamertag aus Session-Metadaten holen, nicht aus localStorage
  const gamertag = session?.user?.user_metadata?.gamertag
    || localStorage.getItem(STORAGE.GAMERTAG)
    || '';

  const entry = {
    played_date: getTodayString(),
    score,
    correct,
    wrong,
    gamertag,
  };

  if (!session) {
    queuePendingResult(entry);
    return 'queued';
  }

  try {
    const { error } = await sb.from('wettkampf_history').insert({
      ...entry,
      user_id: session.user.id,
    });
    if (error) {
      queuePendingResult(entry);
      return 'queued';
    }
    return 'saved';
  } catch (_) {
    queuePendingResult(entry);
    return 'queued';
  }
}

// Beim Laden ausstehende Ergebnisse nachsenden, sobald online
window.addEventListener('online', flushPendingResults);
flushPendingResults();

const STORAGE = {
  GAMERTAG: "quiz_gamertag",
  LAST_PLAY_DATE: "quiz_lastPlayDate",
  LEADERBOARD: "quiz_leaderboard",
  STREAK: "quiz_streak",
  STREAK_DATE: "quiz_streak_date",
};

const QUESTION_COUNT = 15;
const TIMER_SECONDS = 15;
const WK_COUNT_KEY = 'quiz_wk_count';
const WK_MAX_PER_DAY = 3;

function getTodayPlayCount() {
  try {
    const data = JSON.parse(localStorage.getItem(WK_COUNT_KEY) || '{}');
    return data.date === getTodayString() ? (data.count || 0) : 0;
  } catch { return 0; }
}

function incrementPlayCount() {
  const count = getTodayPlayCount() + 1;
  localStorage.setItem(WK_COUNT_KEY, JSON.stringify({ date: getTodayString(), count }));
  localStorage.setItem(STORAGE.LAST_PLAY_DATE, getTodayString());
  return count;
}

function getRemainingPlays() {
  return Math.max(0, WK_MAX_PER_DAY - getTodayPlayCount());
}

function getMsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

function formatCountdown(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function updateIntroStatus() {
  const count = getTodayPlayCount();
  const statusEl = document.getElementById('wk-play-status');
  const startBtn = document.getElementById('btn-start-wettkampf');
  const rewardedIntroBtn = document.getElementById('btn-rewarded-play-intro');
  if (!statusEl || !startBtn) return;

  if (count === 0) {
    statusEl.textContent = '';
    startBtn.disabled = false;
    startBtn.textContent = 'Wettkampf starten';
    if (rewardedIntroBtn) rewardedIntroBtn.style.display = 'none';
  } else if (count < WK_MAX_PER_DAY) {
    const remaining = WK_MAX_PER_DAY - count;
    statusEl.innerHTML = `Heute bereits gespielt · <strong>${remaining}× via Werbung</strong> noch möglich`;
    startBtn.disabled = true;
    startBtn.textContent = 'Bereits gespielt';
    if (rewardedIntroBtn) {
      rewardedIntroBtn.style.display = '';
      rewardedIntroBtn.textContent = `🎬 Nochmal spielen · noch ${remaining}× heute möglich`;
    }
  } else {
    startBtn.disabled = true;
    startBtn.textContent = 'Heute nicht mehr möglich';
    if (rewardedIntroBtn) rewardedIntroBtn.style.display = 'none';
    const tick = () => {
      statusEl.textContent = `Nächster Wettkampf in ${formatCountdown(getMsUntilMidnight())}`;
    };
    tick();
    const id = setInterval(() => {
      if (getTodayPlayCount() === 0) { clearInterval(id); updateIntroStatus(); return; }
      tick();
    }, 1000);
  }
}

// Gamertag-Check und bereits-gespielt-Check
if (!localStorage.getItem(STORAGE.GAMERTAG)) {
  window.location.href = "../index.html";
}

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hasPlayedToday() {
  return localStorage.getItem(STORAGE.LAST_PLAY_DATE) === getTodayString();
}

function getStreak() {
  return parseInt(localStorage.getItem(STORAGE.STREAK) || '0', 10);
}

function updateStreak() {
  const today = getTodayString();
  const yesterday = getYesterdayString();
  const lastDate = localStorage.getItem(STORAGE.STREAK_DATE);
  let streak = getStreak();

  if (lastDate === today) {
    // Heute schon gezählt, nichts ändern
    return streak;
  } else if (lastDate === yesterday) {
    streak++;
  } else {
    streak = 1;
  }

  localStorage.setItem(STORAGE.STREAK, String(streak));
  localStorage.setItem(STORAGE.STREAK_DATE, today);
  return streak;
}

function renderStreakDisplay(streak) {
  const pill = document.getElementById('streak-pill');
  if (!pill) return;
  if (streak >= 1) {
    document.getElementById('streak-pill-count').textContent = streak;
    pill.style.display = '';
  } else {
    pill.style.display = 'none';
  }
}

// ========== STATE ==========
const state = {
  questions: [],
  currentIndex: 0,
  correct: 0,
  wrong: 0,
  score: 0,
  streak: 0,
  answered: false,
  timerInterval: null,
  timeLeft: TIMER_SECONDS,
};

// ========== SCREENS ==========
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

// ========== QUIZ ==========
function startWettkampf() {
  Ads.startTracking();
  incrementPlayCount();

  const schwerPool = [];
  Object.values(QUESTIONS).forEach((qs) => {
    qs.filter((q) => q.difficulty === "schwer").forEach((q) => schwerPool.push(q));
  });

  const shuffled = shuffle(schwerPool);
  state.questions = shuffled.slice(0, QUESTION_COUNT);
  state.currentIndex = 0;
  state.correct = 0;
  state.wrong = 0;
  state.score = 0;
  state.streak = 0;
  state.answered = false;

  showScreen("screen-quiz");
  SoundSystem.startBgMusic();
  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  state.answered = false;

  document.getElementById("wk-counter").textContent =
    `${state.currentIndex + 1} / ${QUESTION_COUNT}`;
  document.getElementById("wk-score").textContent = state.score;

  const isLast = state.currentIndex === QUESTION_COUNT - 1;
  document.getElementById("next-btn").textContent = isLast ? "Ergebnis anzeigen" : "Nächste Frage";
  document.getElementById("next-btn").disabled = true;

  document.getElementById("question-text").textContent = q.question;
  renderAnswers(q);
  startTimer();
}

function renderAnswers(q) {
  const list = document.getElementById("answers-list");
  list.innerHTML = "";
  const letters = ["A", "B", "C", "D"];

  q.answers.forEach((answer, idx) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.innerHTML = `
      <span class="answer-letter">${letters[idx]}</span>
      <span class="answer-text">${answer}</span>
    `;
    btn.addEventListener("click", () => onAnswerSelected(idx));
    list.appendChild(btn);
  });
}

function onAnswerSelected(selectedIdx) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();

  const q = state.questions[state.currentIndex];
  const buttons = document.querySelectorAll("#answers-list .answer-btn");
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) btn.classList.add("correct");
    else if (idx === selectedIdx) btn.classList.add("wrong");
  });

  if (selectedIdx === q.correctIndex) {
    state.correct++;
    state.score++;
    state.streak++;
    if (state.streak % 5 === 0) {
      setTimeout(() => SoundSystem.playStreak(), 200);
    } else {
      SoundSystem.playCorrect();
    }
  } else {
    state.wrong++;
    state.score--;
    state.streak = 0;
    SoundSystem.playWrong();
  }

  updateScoreDisplay();
  document.getElementById("next-btn").disabled = false;
}

function onTimeout() {
  if (state.answered) return;
  state.answered = true;
  stopTimer();

  const q = state.questions[state.currentIndex];
  const buttons = document.querySelectorAll("#answers-list .answer-btn");
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) btn.classList.add("correct");
  });

  state.wrong++;
  state.score--;
  state.streak = 0;
  SoundSystem.playWrong();

  updateScoreDisplay();
  document.getElementById("next-btn").disabled = false;
}

function updateScoreDisplay() {
  document.getElementById("wk-score").textContent = state.score;
  const pill = document.getElementById("wk-score-pill");
  pill.classList.remove("bump");
  void pill.offsetWidth;
  pill.classList.add("bump");
}

function onNext() {
  if (state.currentIndex < QUESTION_COUNT - 1) {
    state.currentIndex++;
    renderQuestion();
  } else {
    finishWettkampf();
  }
}

// ========== TIMER ==========
function startTimer() {
  const bar = document.getElementById("timer-bar");
  const fill = document.getElementById("timer-fill");
  const text = document.getElementById("timer-text");

  state.timeLeft = TIMER_SECONDS;
  fill.style.transform = "scaleX(1)";
  fill.style.transition = "none";
  bar.classList.remove("warning");
  text.textContent = TIMER_SECONDS;

  void fill.offsetWidth;
  fill.style.transition = `transform ${TIMER_SECONDS}s linear`;
  fill.style.transform = "scaleX(0)";

  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    text.textContent = state.timeLeft;
    if (state.timeLeft <= 5) bar.classList.add("warning");
    if (state.timeLeft > 0) SoundSystem.playTick();
    if (state.timeLeft <= 0) {
      stopTimer();
      onTimeout();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  document.getElementById("timer-bar").classList.remove("warning");
}

// ========== ABSCHLUSS + RANGLISTE ==========
function finishWettkampf() {
  stopTimer();
  SoundSystem.stopBgMusic();

  // localStorage.setItem(STORAGE.LAST_PLAY_DATE, getTodayString());

  const newStreak = updateStreak();
  showResult({ gamertag: localStorage.getItem(STORAGE.GAMERTAG), score: state.score, correct: state.correct, wrong: state.wrong }, newStreak);
  saveWettkampfHistory(state.score, state.correct, state.wrong).then(status => {
    const el = document.getElementById('result-pending-hint');
    if (el) el.style.display = status === 'queued' ? 'block' : 'none';
  });
}

function showResult(entry, streak) {
  const { score, correct, wrong } = entry;

  let emoji, title, subtitle;
  if (score >= 14)      { emoji = "🏆"; title = "Legendär!";        subtitle = "Nahezu perfekte Leistung!"; }
  else if (score >= 11) { emoji = "🎉"; title = "Sehr stark!";      subtitle = "Du hast den Wettkampf dominiert."; }
  else if (score >= 7)  { emoji = "👍"; title = "Gute Leistung!";   subtitle = "Noch ein bisschen Luft nach oben."; }
  else if (score >= 0)  { emoji = "🤔"; title = "Knappes Ergebnis"; subtitle = "Beim nächsten Mal klappt's besser!"; }
  else                  { emoji = "📚"; title = "Noch üben!";       subtitle = "Nutze den Übungs-Modus zum Lernen."; }

  document.getElementById("result-emoji").textContent = emoji;
  document.getElementById("result-title").textContent = title;
  document.getElementById("result-subtitle").textContent = subtitle;
  document.getElementById("result-correct").textContent = correct;
  document.getElementById("result-wrong").textContent = wrong;
  document.getElementById("result-score").textContent = score;

  const streakEl = document.getElementById("result-streak");
  if (streakEl) {
    if (streak >= 2) {
      streakEl.innerHTML = `🔥 <strong>${streak}</strong> Tage in Folge`;
    } else {
      streakEl.innerHTML = `🔥 Tag 1 · Streak gestartet`;
    }
    streakEl.style.display = 'block';
  }

  showScreen("screen-result");

  const remaining = getRemainingPlays();
  const rewardedBtn = document.getElementById('btn-rewarded-play');
  if (rewardedBtn) {
    if (remaining > 0) {
      rewardedBtn.style.display = '';
      rewardedBtn.textContent = `🎬 Nochmal spielen · noch ${remaining}× heute möglich`;
    } else {
      rewardedBtn.style.display = 'none';
    }
  }
}

// ========== UTILS ==========
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== INIT ==========
document.addEventListener("DOMContentLoaded", () => {
  renderStreakDisplay(getStreak());
  updateIntroStatus();

  document.getElementById("btn-back-intro").addEventListener("click", () => {
    window.location.href = "../index.html";
  });

  document.getElementById("btn-start-wettkampf").addEventListener("click", () => {
    startWettkampf();
  });

  document.getElementById("btn-intro-rangliste").addEventListener("click", () => {
    window.location.href = "../rangliste/index.html";
  });

  document.getElementById("btn-back-quiz").addEventListener("click", () => {
    stopTimer();
    SoundSystem.stopBgMusic();
    showScreen("screen-intro");
    updateIntroStatus();
  });

  document.getElementById("btn-mute").addEventListener("click", () => {
    const muted = SoundSystem.toggleMute();
    document.getElementById("btn-mute").textContent = muted ? "🔇" : "🔊";
  });

  document.getElementById("next-btn").addEventListener("click", onNext);

  wireReportModal(
    () => state.questions[state.currentIndex],
    (q) => reportFindTopicId(q)
  );

  document.getElementById("btn-to-rangliste").addEventListener("click", () => {
    window.location.href = "../rangliste/index.html";
  });

  document.getElementById("btn-rewarded-play").addEventListener("click", () => {
    Ads.showRewarded(() => {
      startWettkampf();
    });
  });

  document.getElementById("btn-rewarded-play-intro").addEventListener("click", () => {
    Ads.showRewarded(() => {
      startWettkampf();
    });
  });

  document.getElementById("btn-to-home").addEventListener("click", () => {
    Ads.maybeInterstitial(() => {
      window.location.href = "../index.html";
    });
  });
});
