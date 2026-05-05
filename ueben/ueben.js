// Üben-Modus: Thema → Modus → (Schwierigkeit) → Quiz

const SESSION_LENGTH = 200;

const state = {
  currentTopic: null,
  currentDifficulty: null,
  mode: 'random',       // 'random' | 'repeat'
  questionPool: [],
  sessionQuestions: [],
  currentIndex: 0,
  currentQuestion: null,
  answered: false,
  stats: { correct: 0, wrong: 0, streak: 0 },
  userId: null,
  currentWrongCount: 0,
  repeatPool: [],       // question objects still in wrong list
  repeatQueue: [],      // current shuffle pass through repeatPool
};

// ========== CLEANUP & AUTO-REFRESH ==========
// Alle Timer/Listener, die zu einem Screen gehören, werden hier
// registriert und bei jedem Screen-Wechsel automatisch entfernt.
const cleanupTasks = [];
function registerCleanup(fn) { cleanupTasks.push(fn); }
function runCleanup() {
  while (cleanupTasks.length) {
    try { cleanupTasks.pop()(); } catch (e) { console.error('Cleanup error:', e); }
  }
}

function startAutoRefresh(refreshFn, intervalMs = 30000) {
  const interval = setInterval(refreshFn, intervalMs);
  const onVisible = () => { if (!document.hidden) refreshFn(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', refreshFn);
  registerCleanup(() => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', refreshFn);
  });
}

// ========== SCREENS ==========
function showScreen(id) {
  runCleanup();
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
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

function questionHash(q) {
  const str = q.question;
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString();
}

// ========== FRAGEN-COOLDOWN ==========
// Verhindert, dass kürzlich gesehene Fragen sofort wieder auftauchen.
const COOLDOWN_MS = 10 * 60 * 1000;        // 10 Minuten
const COOLDOWN_PRUNE_MS = 24 * 60 * 60 * 1000; // Einträge >24h werden entfernt
const RECENT_KEY = 'quiz_recent_questions';

function loadRecentSeen() {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}');
    const now = Date.now();
    const pruned = {};
    for (const [hash, ts] of Object.entries(data)) {
      if (now - ts < COOLDOWN_PRUNE_MS) pruned[hash] = ts;
    }
    return pruned;
  } catch { return {}; }
}

function markQuestionSeen(q) {
  const recent = loadRecentSeen();
  recent[questionHash(q)] = Date.now();
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {}
}

function pickNextRandomQuestion(pool, lastQuestion) {
  if (pool.length === 0) return null;
  const recent = loadRecentSeen();
  const now = Date.now();
  const lastHash = lastQuestion ? questionHash(lastQuestion) : null;

  // 1. Wahl: nicht im Cooldown UND nicht die direkt vorherige Frage
  const fresh = pool.filter(q => {
    const h = questionHash(q);
    if (h === lastHash) return false;
    const seen = recent[h];
    return !seen || (now - seen) > COOLDOWN_MS;
  });

  if (fresh.length > 0) {
    return fresh[Math.floor(Math.random() * fresh.length)];
  }

  // Fallback (kleiner Pool): am längsten nicht gesehen, aber nicht die letzte
  const candidates = pool.length > 1
    ? pool.filter(q => questionHash(q) !== lastHash)
    : pool;
  const sorted = [...candidates].sort((a, b) =>
    (recent[questionHash(a)] || 0) - (recent[questionHash(b)] || 0)
  );
  return sorted[0];
}

// ========== OFFLINE QUEUE ==========
const OFFLINE_STATS_KEY = 'quiz_pending_stats';
const OFFLINE_WRONG_KEY = 'quiz_pending_wrong';

function getPendingStats() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_STATS_KEY)) || {}; }
  catch { return {}; }
}

function getPendingWrong() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_WRONG_KEY)) || []; }
  catch { return []; }
}

function queueStatUpdate(userId, topicId, correct) {
  const pending = getPendingStats();
  if (!pending[userId]) pending[userId] = {};
  if (!pending[userId][topicId]) pending[userId][topicId] = { total: 0, correct: 0 };
  pending[userId][topicId].total++;
  if (correct) pending[userId][topicId].correct++;
  localStorage.setItem(OFFLINE_STATS_KEY, JSON.stringify(pending));
}

function queueWrongChange(action, userId, topicId, hash) {
  const pending = getPendingWrong();
  const filtered = pending.filter(e => !(e.userId === userId && e.topicId === topicId && e.hash === hash));
  filtered.push({ action, userId, topicId, hash });
  localStorage.setItem(OFFLINE_WRONG_KEY, JSON.stringify(filtered));
}

async function syncPendingData() {
  if (!state.userId) return;

  // Sync stats
  const pendingStats = getPendingStats();
  const userStats = pendingStats[state.userId];
  if (userStats) {
    for (const [topicId, delta] of Object.entries(userStats)) {
      try {
        const { data } = await sb.from('topic_stats')
          .select('total_answered, correct_answered')
          .eq('user_id', state.userId)
          .eq('topic_id', topicId)
          .single();
        const cur = data || { total_answered: 0, correct_answered: 0 };
        await sb.from('topic_stats').upsert({
          user_id: state.userId,
          topic_id: topicId,
          total_answered: cur.total_answered + delta.total,
          correct_answered: cur.correct_answered + delta.correct,
        }, { onConflict: 'user_id,topic_id' });
        delete userStats[topicId];
      } catch (e) { console.error('Stat-Sync Fehler:', e); }
    }
    pendingStats[state.userId] = userStats;
    localStorage.setItem(OFFLINE_STATS_KEY, JSON.stringify(pendingStats));
  }

  // Sync wrong questions
  const pendingWrong = getPendingWrong();
  const remaining = [];
  for (const entry of pendingWrong) {
    if (entry.userId !== state.userId) { remaining.push(entry); continue; }
    try {
      if (entry.action === 'add') {
        await sb.from('wrong_questions').upsert({
          user_id: entry.userId,
          topic_id: entry.topicId,
          question_hash: entry.hash,
        }, { onConflict: 'user_id,topic_id,question_hash' });
      } else {
        await sb.from('wrong_questions')
          .delete()
          .eq('user_id', entry.userId)
          .eq('topic_id', entry.topicId)
          .eq('question_hash', entry.hash);
      }
    } catch (e) {
      console.error('Wrong-Sync Fehler:', e);
      remaining.push(entry);
    }
  }
  localStorage.setItem(OFFLINE_WRONG_KEY, JSON.stringify(remaining));
}

// ========== SUPABASE: FALSCHE FRAGEN ==========
async function loadWrongCount(topicId) {
  if (!state.userId) return 0;
  const { count } = await sb
    .from('wrong_questions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', state.userId)
    .eq('topic_id', topicId);
  return count || 0;
}

async function loadWrongQuestions(topicId) {
  if (!state.userId) return [];
  const { data } = await sb
    .from('wrong_questions')
    .select('question_hash')
    .eq('user_id', state.userId)
    .eq('topic_id', topicId);
  if (!data || data.length === 0) return [];

  const hashes = new Set(data.map(r => r.question_hash));
  return (QUESTIONS[topicId] || []).filter(q => hashes.has(questionHash(q)));
}

async function saveWrongQuestion(question) {
  if (!state.userId) return;
  const hash = questionHash(question);
  const topicId = state.currentTopic.id;
  try {
    await sb.from('wrong_questions').upsert({
      user_id: state.userId,
      topic_id: topicId,
      question_hash: hash,
    }, { onConflict: 'user_id,topic_id,question_hash' });
  } catch {
    queueWrongChange('add', state.userId, topicId, hash);
  }
}

async function removeWrongQuestion(question) {
  if (!state.userId) return;
  const hash = questionHash(question);
  const topicId = state.currentTopic.id;
  try {
    await sb.from('wrong_questions')
      .delete()
      .eq('user_id', state.userId)
      .eq('topic_id', topicId)
      .eq('question_hash', hash);
  } catch {
    queueWrongChange('remove', state.userId, topicId, hash);
  }
}

async function trackAnswer(correct) {
  if (!state.userId) return;
  const topicId = state.currentTopic.id;
  try {
    const { data } = await sb.from('topic_stats')
      .select('total_answered, correct_answered')
      .eq('user_id', state.userId)
      .eq('topic_id', topicId)
      .single();
    const cur = data || { total_answered: 0, correct_answered: 0 };
    await sb.from('topic_stats').upsert({
      user_id: state.userId,
      topic_id: topicId,
      total_answered: cur.total_answered + 1,
      correct_answered: cur.correct_answered + (correct ? 1 : 0),
    }, { onConflict: 'user_id,topic_id' });
  } catch {
    queueStatUpdate(state.userId, topicId, correct);
  }
}

// ========== THEMEN ==========
function renderTopicCards(container, counts) {
  container.innerHTML = "";
  TOPICS.forEach((topic, i) => {
    const wrongCount = counts[i] || 0;
    const card = document.createElement("button");
    card.className = "topic-card";
    card.dataset.topicId = topic.id;
    card.style.setProperty("--card-color", topic.color);
    card.innerHTML = `
      <span class="topic-icon">${topic.icon}</span>
      <div class="topic-info">
        <div class="topic-name">${topic.name}</div>
        <div class="topic-description">${topic.description}</div>
      </div>
      ${wrongCount > 0
        ? `<span class="wrong-badge">${wrongCount}</span>`
        : '<span class="topic-arrow">›</span>'}
    `;
    card.addEventListener("click", () => onTopicSelected(topic, wrongCount));
    container.appendChild(card);
  });
}

async function refreshTopicBadges(container) {
  try {
    const counts = await Promise.race([
      Promise.all(TOPICS.map(t => loadWrongCount(t.id))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    renderTopicCards(container, counts);
  } catch (_) {}
}

async function renderTopicSelection() {
  document.getElementById("subtitle").textContent = "Themengebiet wählen";
  const container = document.getElementById("topics-grid");

  // Sofort rendern ohne Wartezeit
  renderTopicCards(container, []);
  showScreen("screen-topics");

  // Badges asynchron nachladen + periodisch aktualisieren
  await refreshTopicBadges(container);
  startAutoRefresh(() => refreshTopicBadges(container), 30000);
}

function onTopicSelected(topic, wrongCount) {
  state.currentTopic = topic;
  state.currentWrongCount = wrongCount;
  renderModeSelection(wrongCount);
}

// ========== MODUS-AUSWAHL ==========
function updateModeScreenCount(wrongCount) {
  const repeatBtn = document.getElementById("btn-mode-repeat");
  const repeatLabel = document.getElementById("wrong-count-label");
  if (!repeatBtn || !repeatLabel) return;

  if (wrongCount === 0) {
    repeatLabel.innerHTML = `<span class="mode-count-badge mode-count-empty">Keine Fragen</span>`;
    repeatBtn.disabled = true;
    repeatBtn.classList.add("disabled");
  } else {
    repeatLabel.innerHTML = `<span class="mode-count-badge">${wrongCount} Frage${wrongCount !== 1 ? 'n' : ''}</span>`;
    repeatBtn.disabled = false;
    repeatBtn.classList.remove("disabled");
  }
}

function renderModeSelection(wrongCount) {
  document.getElementById("subtitle").textContent = `${state.currentTopic.name} — Modus wählen`;
  updateModeScreenCount(wrongCount);
  showScreen("screen-mode");
}

// Mode-Screen betreten: Cache anzeigen, frisch nachladen, periodisch refreshen.
async function enterModeScreen() {
  if (!state.currentTopic) { showScreen("screen-mode"); return; }
  document.getElementById("subtitle").textContent = `${state.currentTopic.name} — Modus wählen`;
  updateModeScreenCount(state.currentWrongCount);
  showScreen("screen-mode");

  const refresh = async () => {
    if (!state.currentTopic) return;
    try {
      const c = await loadWrongCount(state.currentTopic.id);
      state.currentWrongCount = c;
      updateModeScreenCount(c);
    } catch {}
  };
  await refresh();
  startAutoRefresh(refresh, 30000);
}

// ========== SCHWIERIGKEIT ==========
function renderDifficultySelection() {
  document.getElementById("subtitle").textContent =
    `${state.currentTopic.name} — Schwierigkeit wählen`;
  const container = document.getElementById("difficulty-grid");
  container.innerHTML = "";

  // Gemischt-Karte zuerst
  const allQuestions = QUESTIONS[state.currentTopic.id] || [];
  const mixedCard = document.createElement("button");
  mixedCard.className = "topic-card";
  mixedCard.style.setProperty("--card-color", "#6366f1");
  mixedCard.innerHTML = `
    <span class="topic-icon">🔀</span>
    <div class="topic-info">
      <div class="topic-name">Gemischt</div>
      <div class="topic-description">Alle Schwierigkeiten gemischt</div>
    </div>
    <span class="topic-arrow">›</span>
  `;
  mixedCard.addEventListener("click", () => startRandomQuiz(null));
  container.appendChild(mixedCard);

  DIFFICULTIES.forEach((diff) => {
    const available = allQuestions.filter((q) => q.difficulty === diff.id).length;

    const card = document.createElement("button");
    card.className = "topic-card";
    card.style.setProperty("--card-color", diff.color);
    card.innerHTML = `
      <span class="topic-icon">${diff.icon}</span>
      <div class="topic-info">
        <div class="topic-name">${diff.name}</div>
        <div class="topic-description">${diff.description}</div>
      </div>
      <span class="topic-arrow">›</span>
    `;
    card.addEventListener("click", () => {
      if (available === 0) {
        const hint = document.getElementById('difficulty-hint');
      if (hint) { hint.textContent = 'Für diese Schwierigkeit gibt es noch keine Fragen.'; setTimeout(() => { hint.textContent = ''; }, 3000); }
      return;
      }
      startRandomQuiz(diff);
    });
    container.appendChild(card);
  });

  showScreen("screen-difficulty");
}

// ========== QUIZ: ZUFÄLLIG ==========
function startRandomQuiz(difficulty) {
  Ads.startTracking();
  state.mode = 'random';
  state.currentDifficulty = difficulty;
  const allQuestions = QUESTIONS[state.currentTopic.id] || [];
  state.questionPool = difficulty
    ? allQuestions.filter((q) => q.difficulty === difficulty.id)
    : allQuestions;
  state.sessionQuestions = [];
  state.currentIndex = 0;
  state.stats = { correct: 0, wrong: 0, streak: 0 };
  state.answered = false;

  document.getElementById("subtitle").textContent =
    `${state.currentTopic.name} · ${difficulty ? difficulty.name : 'Gemischt'}`;
  document.getElementById("repeat-progress").textContent = "";
  resetStatDisplay();
  showScreen("screen-quiz");
  SoundSystem.startBgMusic();
  renderNextQuestion();
}

// ========== QUIZ: WIEDERHOLEN ==========
async function startRepeatQuiz() {
  state.mode = 'repeat';
  state.currentDifficulty = null;

  const btn = document.getElementById("btn-mode-repeat");
  btn.textContent = "Lade...";
  btn.disabled = true;

  const wrongQuestions = await loadWrongQuestions(state.currentTopic.id);
  btn.innerHTML = `<span class="topic-icon">🔁</span>
    <div class="topic-info">
      <div class="topic-name">Falsche Fragen wiederholen</div>
      <div class="topic-description" id="wrong-count-label"></div>
    </div>
    <span class="topic-arrow">›</span>`;
  renderModeSelection(state.currentWrongCount);

  if (wrongQuestions.length === 0) {
    const hint = document.getElementById('mode-hint');
    if (hint) { hint.textContent = 'Keine falschen Fragen mehr – alles richtig!'; setTimeout(() => { hint.textContent = ''; }, 3000); }
    return;
  }

  Ads.startTracking();
  state.repeatPool = [...wrongQuestions];
  state.repeatQueue = shuffle([...wrongQuestions]);
  state.stats = { correct: 0, wrong: 0, streak: 0 };
  state.answered = false;

  document.getElementById("subtitle").textContent =
    `${state.currentTopic.name} · Wiederholen`;
  resetStatDisplay();
  updateRepeatProgress();
  showScreen("screen-quiz");
  SoundSystem.startBgMusic();
  renderNextRepeatQuestion();
}

function renderNextRepeatQuestion() {
  if (state.repeatPool.length === 0) {
    showRepeatResult();
    return;
  }
  if (state.repeatQueue.length === 0) {
    state.repeatQueue = shuffle([...state.repeatPool]);
  }
  state.currentQuestion = state.repeatQueue.shift();
  markQuestionSeen(state.currentQuestion);
  state.answered = false;

  document.getElementById("question-text").textContent = state.currentQuestion.question;
  renderAnswers(state.currentQuestion);
  document.getElementById("next-btn").disabled = true;
  updateRepeatProgress();
}

function updateRepeatProgress() {
  const remaining = state.repeatPool.length;
  const el = document.getElementById("repeat-progress");
  if (el) el.textContent = remaining > 0 ? `Noch ${remaining} offen` : "";
}

function showRepeatResult() {
  const { correct, wrong } = state.stats;
  const total = correct + wrong;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 100;

  document.getElementById("session-result-emoji").textContent = "🎉";
  document.getElementById("session-result-title").textContent = "Alle gemeistert!";
  document.getElementById("session-result-subtitle").textContent =
    "Du hast alle falschen Fragen richtig beantwortet.";
  document.getElementById("session-result-correct").textContent = correct;
  document.getElementById("session-result-wrong").textContent = wrong;
  document.getElementById("session-result-percent").textContent = `${percent}%`;

  showScreen("screen-session-result");
}

// ========== QUIZ: ALLGEMEIN ==========
function renderNextQuestion() {
  if (state.mode === 'repeat') {
    renderNextRepeatQuestion();
    return;
  }
  if (state.currentIndex >= SESSION_LENGTH) {
    showSessionResult();
    return;
  }
  const previous = state.currentQuestion;
  state.currentQuestion = pickNextRandomQuestion(state.questionPool, previous);
  if (!state.currentQuestion) { showSessionResult(true); return; }
  markQuestionSeen(state.currentQuestion);
  state.answered = false;

  document.getElementById("question-text").textContent = state.currentQuestion.question;
  renderAnswers(state.currentQuestion);
  document.getElementById("next-btn").disabled = true;
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

  const q = state.currentQuestion;
  const buttons = document.querySelectorAll("#answers-list .answer-btn");
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) btn.classList.add("correct");
    else if (idx === selectedIdx) btn.classList.add("wrong");
  });

  if (selectedIdx === q.correctIndex) {
    state.stats.correct++;
    state.stats.streak++;
    const milestone = isStreakMilestone(state.stats.streak);
    updateStat("correct");
    updateStat("streak", milestone);
    if (milestone && state.stats.streak >= 5) {
      setTimeout(() => SoundSystem.playStreak(), 200);
    } else {
      SoundSystem.playCorrect();
    }
    removeWrongQuestion(q);
    trackAnswer(true);
    if (state.mode === 'repeat') {
      const hash = questionHash(q);
      state.repeatPool = state.repeatPool.filter(rq => questionHash(rq) !== hash);
      state.repeatQueue = state.repeatQueue.filter(rq => questionHash(rq) !== hash);
      updateRepeatProgress();
    }
  } else {
    state.stats.wrong++;
    state.stats.streak = 0;
    updateStat("wrong");
    updateStat("streak");
    SoundSystem.playWrong();
    saveWrongQuestion(q);
    trackAnswer(false);
  }

  if (state.mode === 'repeat') {
    const isLast = state.repeatPool.length === 0;
    document.getElementById("next-btn").disabled = false;
    document.getElementById("next-btn").textContent = isLast ? "Ergebnis anzeigen" : "Nächste Frage";
  } else {
    state.currentIndex++;
    const isLast = state.currentIndex >= SESSION_LENGTH;
    document.getElementById("next-btn").disabled = false;
    document.getElementById("next-btn").textContent = isLast ? "Ergebnis anzeigen" : "Nächste Frage";
  }
}

// ========== SESSION-ERGEBNIS ==========
function showSessionResult(poolExhausted = false) {
  const { correct, wrong } = state.stats;
  const total = correct + wrong;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 100;

  let emoji, title, subtitle;

  if (poolExhausted) {
    emoji = "🌟";
    title = "Thema gemeistert!";
    subtitle = "Du hast alle Fragen in diesem Thema gesehen. Bald kommen neue dazu!";
  } else if (percent >= 90) { emoji = "🏆"; title = "Hervorragend!";    subtitle = "Fast perfekte Session!"; }
  else if (percent >= 75)   { emoji = "🎉"; title = "Sehr gut!";        subtitle = "Du beherrschst das Thema."; }
  else if (percent >= 60)   { emoji = "👍"; title = "Gute Leistung!";   subtitle = "Noch etwas Luft nach oben."; }
  else if (percent >= 40)   { emoji = "🤔"; title = "Weiter üben!";     subtitle = "Du bist auf dem richtigen Weg."; }
  else                      { emoji = "📚"; title = "Viel zu lernen!";   subtitle = "Bleib dabei – es wird besser!"; }

  document.getElementById("session-result-emoji").textContent = emoji;
  document.getElementById("session-result-title").textContent = title;
  document.getElementById("session-result-subtitle").textContent = subtitle;
  document.getElementById("session-result-correct").textContent = correct;
  document.getElementById("session-result-wrong").textContent = wrong;
  document.getElementById("session-result-percent").textContent = `${percent}%`;

  const otherSection = document.getElementById("other-topics-section");
  if (otherSection) {
    if (poolExhausted && state.currentTopic) {
      const others = TOPICS.filter(t => t.id !== state.currentTopic.id);
      otherSection.innerHTML = `
        <p style="font-size:13px;color:#94a3b8;margin:0 0 10px">Lerne andere Themen:</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
          ${others.map(t => `
            <button class="other-topic-btn" data-topic-id="${t.id}" style="background:${t.color}22;border:1px solid ${t.color}44;color:#e2e8f0;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer">
              ${t.icon} ${t.name}
            </button>
          `).join('')}
        </div>
      `;
      otherSection.querySelectorAll('.other-topic-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const topic = TOPICS.find(t => t.id === btn.dataset.topicId);
          if (topic) { onTopicSelected(topic, 0); }
        });
      });
      otherSection.style.display = '';
    } else {
      otherSection.style.display = 'none';
    }
  }

  showScreen("screen-session-result");
}

// ========== STATS ==========
function resetStatDisplay() {
  ["correct", "wrong", "streak"].forEach((k) => {
    document.getElementById(`stat-${k}`).textContent = "0";
  });
}

function isStreakMilestone(n) {
  return n === 3 || (n >= 5 && n % 5 === 0);
}

function updateStat(key, milestone = false) {
  const el = document.getElementById(`stat-${key}`);
  el.textContent = state.stats[key];
  const stat = el.closest(".stat");
  stat.classList.remove("bump", "milestone");
  void stat.offsetWidth;
  if (milestone) {
    stat.classList.add("milestone");
    setTimeout(() => stat.classList.remove("milestone"), 650);
    const toast = document.getElementById("streak-toast");
    if (toast) {
      toast.textContent = `🔥 ${state.stats[key]}er Serie!`;
      toast.classList.remove("show");
      void toast.offsetWidth;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1500);
    }
  } else {
    stat.classList.add("bump");
    setTimeout(() => stat.classList.remove("bump"), 250);
  }
}

// ========== INIT ==========
document.addEventListener("DOMContentLoaded", async () => {
  loadAndApplyOverrides().catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "../index.html";
    return;
  }
  state.userId = session.user.id;

  // Offline-Queue synchronisieren sobald eingeloggt
  syncPendingData().catch(() => {});

  document.getElementById("btn-back-topics").addEventListener("click", () => {
    window.location.href = "../index.html";
  });

  document.getElementById("btn-back-mode").addEventListener("click", () => {
    renderTopicSelection();
  });

  document.getElementById("btn-back-difficulty").addEventListener("click", () => {
    enterModeScreen();
  });

  document.getElementById("btn-back-quiz").addEventListener("click", () => {
    SoundSystem.stopBgMusic();
    if (state.mode === 'repeat') {
      enterModeScreen();
    } else {
      document.getElementById("subtitle").textContent =
        `${state.currentTopic?.name || ""} — Schwierigkeit wählen`;
      showScreen("screen-difficulty");
    }
  });

  document.getElementById("btn-mode-random").addEventListener("click", () => {
    renderDifficultySelection();
  });

  document.getElementById("btn-mode-repeat").addEventListener("click", () => {
    startRepeatQuiz();
  });

  document.getElementById("btn-mute").addEventListener("click", () => {
    const muted = SoundSystem.toggleMute();
    document.getElementById("btn-mute").textContent = muted ? "🔇" : "🔊";
  });

  document.getElementById("next-btn").addEventListener("click", () => {
    Ads.maybeInterstitial(renderNextQuestion);
  });

  wireReportModal(
    () => state.currentQuestion,
    () => state.currentTopic ? state.currentTopic.id : 'unknown'
  );

  document.getElementById("btn-play-again").addEventListener("click", () => {
    if (state.mode === 'repeat') {
      startRepeatQuiz();
    } else {
      startRandomQuiz(state.currentDifficulty);
    }
  });

  document.getElementById("btn-session-to-home").addEventListener("click", () => {
    renderTopicSelection();
  });

  renderTopicSelection();
});
