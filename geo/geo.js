// Geographie-Üben: Flaggen, Hauptstädte, Umrisse

const SESSION_LENGTH = 50;

const GEO_MODES = [
  { id: 'geo_flaggen',      name: 'Flaggen',     icon: '🚩', color: '#10b981', desc: 'Erkenne Flaggen der Welt' },
  { id: 'geo_hauptstaedte', name: 'Hauptstädte', icon: '🏛️', color: '#06b6d4', desc: 'Ländernamen und Hauptstädte' },
  { id: 'geo_umrisse',      name: 'Umrisse',     icon: '🗺️', color: '#8b5cf6', desc: 'Erkenne Länder an ihrer Form' },
];

const CONTINENT_BOUNDS = {
  europa:       { x: [-25, 45],   y: [30,  73] },
  asien:        { x: [25,  150],  y: [-15, 77] },
  afrika:       { x: [-20, 52],   y: [-36, 38] },
  nordamerika:  { x: [-170, -52], y: [5,   84] },
  suedamerika:  { x: [-82, -34],  y: [-56, 14] },
  ozeanien:     { x: [110, 180],  y: [-48, 5]  },
};

const state = {
  topicId: null,
  quizMode: 'random',
  questionPool: [],
  repeatPool: [],
  repeatQueue: [],
  currentQuestion: null,
  currentIndex: 0,
  answered: false,
  stats: { correct: 0, wrong: 0, streak: 0 },
  userId: null,
  currentWrongCount: 0,
};

// ── Cleanup ──────────────────────────────────────────────────
const cleanupTasks = [];
function registerCleanup(fn) { cleanupTasks.push(fn); }
function runCleanup() {
  while (cleanupTasks.length) {
    try { cleanupTasks.pop()(); } catch (e) { console.error(e); }
  }
}

function showScreen(id) {
  runCleanup();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function showToast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

// ── Offline-Queue (analog zu ueben.js) ──────────────────────
const OFFLINE_STATS_KEY = 'quiz_pending_stats';
const OFFLINE_WRONG_KEY = 'quiz_pending_wrong';

function getPendingStats() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_STATS_KEY)) || {}; } catch { return {}; }
}
function getPendingWrong() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_WRONG_KEY)) || []; } catch { return []; }
}

function queueStatUpdate(userId, topicId, correct) {
  const p = getPendingStats();
  if (!p[userId]) p[userId] = {};
  if (!p[userId][topicId]) p[userId][topicId] = { total: 0, correct: 0 };
  p[userId][topicId].total++;
  if (correct) p[userId][topicId].correct++;
  try { localStorage.setItem(OFFLINE_STATS_KEY, JSON.stringify(p)); } catch {}
}

function queueWrongChange(action, userId, topicId, hash) {
  const p = getPendingWrong();
  const filtered = p.filter(e => !(e.userId === userId && e.topicId === topicId && e.hash === hash));
  filtered.push({ action, userId, topicId, hash });
  try { localStorage.setItem(OFFLINE_WRONG_KEY, JSON.stringify(filtered)); } catch {}
}

// ── Fragen-Hashing (identisch zu ueben.js) ──────────────────
function questionHash(q) {
  const str = q.question;
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString();
}

// ── Supabase: Falsche Fragen ─────────────────────────────────
async function loadWrongCount(topicId) {
  if (!state.userId) return 0;
  const { count } = await sb.from('wrong_questions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', state.userId).eq('topic_id', topicId);
  return count || 0;
}

async function loadWrongQuestions(topicId) {
  if (!state.userId) return [];
  const { data } = await sb.from('wrong_questions').select('question_hash')
    .eq('user_id', state.userId).eq('topic_id', topicId);
  if (!data || data.length === 0) return [];
  const hashes = new Set(data.map(r => r.question_hash));
  return (QUESTIONS[topicId] || []).filter(q => hashes.has(questionHash(q)));
}

async function saveWrongQuestion(q) {
  if (!state.userId) return;
  const hash = questionHash(q);
  try {
    await sb.from('wrong_questions').upsert(
      { user_id: state.userId, topic_id: state.topicId, question_hash: hash },
      { onConflict: 'user_id,topic_id,question_hash' }
    );
  } catch { queueWrongChange('add', state.userId, state.topicId, hash); }
}

async function removeWrongQuestion(q) {
  if (!state.userId) return;
  const hash = questionHash(q);
  try {
    await sb.from('wrong_questions').delete()
      .eq('user_id', state.userId).eq('topic_id', state.topicId).eq('question_hash', hash);
  } catch { queueWrongChange('remove', state.userId, state.topicId, hash); }
}

async function trackAnswer(correct) {
  if (!state.userId) return;
  try {
    const { data } = await sb.from('topic_stats').select('total_answered, correct_answered')
      .eq('user_id', state.userId).eq('topic_id', state.topicId).single();
    const cur = data || { total_answered: 0, correct_answered: 0 };
    await sb.from('topic_stats').upsert({
      user_id: state.userId, topic_id: state.topicId,
      total_answered: cur.total_answered + 1,
      correct_answered: cur.correct_answered + (correct ? 1 : 0),
    }, { onConflict: 'user_id,topic_id' });
  } catch { queueStatUpdate(state.userId, state.topicId, correct); }
}

// ── Modus-Auswahl ────────────────────────────────────────────
async function renderModeSelection() {
  document.getElementById('subtitle').textContent = 'Geographie';
  const grid = document.getElementById('modes-grid');
  grid.innerHTML = '';

  for (const mode of GEO_MODES) {
    const wrongCount = state.userId ? await loadWrongCount(mode.id).catch(() => 0) : 0;
    const card = document.createElement('button');
    card.className = 'topic-card';
    card.style.setProperty('--card-color', mode.color);
    card.innerHTML = `
      <span class="topic-icon">${mode.icon}</span>
      <div class="topic-info">
        <div class="topic-name">${mode.name}</div>
        <div class="topic-description">${mode.desc}</div>
      </div>
      ${wrongCount > 0
        ? `<span class="wrong-badge">${wrongCount}</span>`
        : '<span class="topic-arrow">›</span>'}
    `;
    card.addEventListener('click', () => onModeSelected(mode, wrongCount));
    grid.appendChild(card);
  }
  showScreen('screen-modes');
}

function onModeSelected(mode, wrongCount) {
  state.topicId = mode.id;
  state.currentWrongCount = wrongCount;
  renderQuizModeSelection(mode, wrongCount);
}

function renderQuizModeSelection(mode, wrongCount) {
  document.getElementById('subtitle').textContent = `${mode.name} – Modus wählen`;

  const repeatBtn = document.getElementById('btn-mode-repeat');
  const repeatLabel = document.getElementById('wrong-count-label');
  if (wrongCount === 0) {
    repeatLabel.innerHTML = '<span class="mode-count-badge mode-count-empty">Keine Fragen</span>';
    repeatBtn.disabled = true;
    repeatBtn.classList.add('disabled');
  } else {
    repeatLabel.innerHTML = `<span class="mode-count-badge">${wrongCount} Frage${wrongCount !== 1 ? 'n' : ''}</span>`;
    repeatBtn.disabled = false;
    repeatBtn.classList.remove('disabled');
  }
  document.getElementById('quiz-mode-hint').textContent = '';
  showScreen('screen-quiz-mode');
}

// ── Quiz: Zufällig ───────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startRandomQuiz() {
  Ads.startTracking();
  state.quizMode = 'random';
  state.questionPool = shuffle([...(QUESTIONS[state.topicId] || [])]);
  state.currentIndex = 0;
  state.stats = { correct: 0, wrong: 0, streak: 0 };
  state.answered = false;
  document.getElementById('repeat-progress').textContent = '';
  resetStatDisplay();
  showScreen('screen-quiz');
  SoundSystem.startBgMusic();
  renderNextQuestion();
}

// ── Quiz: Falsche wiederholen ────────────────────────────────
async function startRepeatQuiz() {
  const btn = document.getElementById('btn-mode-repeat');
  btn.textContent = 'Lade…';
  btn.disabled = true;

  const wrongQuestions = await loadWrongQuestions(state.topicId);

  // Button zurücksetzen
  const mode = GEO_MODES.find(m => m.id === state.topicId);
  btn.innerHTML = `<span class="topic-icon">🔁</span>
    <div class="topic-info">
      <div class="topic-name">Falsche wiederholen</div>
      <div class="topic-description" id="wrong-count-label"></div>
    </div><span class="topic-arrow">›</span>`;
  renderQuizModeSelection(mode, state.currentWrongCount);

  if (wrongQuestions.length === 0) {
    const hint = document.getElementById('quiz-mode-hint');
    hint.textContent = 'Keine falschen Fragen – alles richtig!';
    setTimeout(() => { hint.textContent = ''; }, 3000);
    return;
  }

  Ads.startTracking();
  state.quizMode = 'repeat';
  state.repeatPool = [...wrongQuestions];
  state.repeatQueue = shuffle([...wrongQuestions]);
  state.stats = { correct: 0, wrong: 0, streak: 0 };
  state.answered = false;
  resetStatDisplay();
  updateRepeatProgress();
  showScreen('screen-quiz');
  SoundSystem.startBgMusic();
  renderNextRepeatQuestion();
}

async function renderNextRepeatQuestion() {
  if (state.repeatPool.length === 0) { showRepeatResult(); return; }
  if (state.repeatQueue.length === 0) state.repeatQueue = shuffle([...state.repeatPool]);
  state.currentQuestion = state.repeatQueue.shift();
  state.answered = false;
  await renderQuestion(state.currentQuestion);
  document.getElementById('next-btn').disabled = true;
  updateRepeatProgress();
}

function updateRepeatProgress() {
  const el = document.getElementById('repeat-progress');
  if (el) el.textContent = state.repeatPool.length > 0 ? `Noch ${state.repeatPool.length} offen` : '';
}

function showRepeatResult() {
  const { correct, wrong } = state.stats;
  const total = correct + wrong;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 100;
  document.getElementById('session-result-emoji').textContent = '🎉';
  document.getElementById('session-result-title').textContent = 'Alle gemeistert!';
  document.getElementById('session-result-subtitle').textContent = 'Du hast alle falschen Fragen richtig beantwortet.';
  document.getElementById('session-result-correct').textContent = correct;
  document.getElementById('session-result-wrong').textContent = wrong;
  document.getElementById('session-result-percent').textContent = `${percent}%`;
  showScreen('screen-session-result');
}

// ── Quiz: Nächste Frage (zufällig) ───────────────────────────
async function renderNextQuestion() {
  if (state.quizMode === 'repeat') { renderNextRepeatQuestion(); return; }
  if (state.currentIndex >= SESSION_LENGTH || state.currentIndex >= state.questionPool.length) {
    showSessionResult();
    return;
  }
  state.currentQuestion = state.questionPool[state.currentIndex];
  state.answered = false;
  await renderQuestion(state.currentQuestion);
  document.getElementById('next-btn').disabled = true;
}

// ── Frage anzeigen ───────────────────────────────────────────
async function renderQuestion(q) {
  const imgContainer = document.getElementById('geo-question-image');
  const textEl = document.getElementById('question-text');

  if (q.question.startsWith('__geo_flag__:')) {
    const code = q.question.slice('__geo_flag__:'.length);
    renderFlagImage(code, imgContainer);
    imgContainer.style.display = '';
    textEl.textContent = 'Welchem Land gehört diese Flagge?';
  } else if (q.question.startsWith('__geo_outline__:')) {
    const code = q.question.slice('__geo_outline__:'.length);
    imgContainer.style.display = '';
    await renderOutlineMap(code, imgContainer);
    textEl.textContent = 'Welches Land ist markiert?';
  } else {
    imgContainer.style.display = 'none';
    imgContainer.innerHTML = '';
    textEl.textContent = q.question;
  }

  const list = document.getElementById('answers-list');
  list.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.answers.forEach((answer, idx) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.innerHTML = `<span class="answer-letter">${letters[idx]}</span><span class="answer-text">${answer}</span>`;
    btn.addEventListener('click', () => onAnswerSelected(idx));
    list.appendChild(btn);
  });
}

// ── Flaggen-Rendering ────────────────────────────────────────
function renderFlagImage(code, container) {
  container.innerHTML = '';
  const img = document.createElement('img');
  img.src = `https://flagcdn.com/w320/${code}.png`;
  img.srcset = `https://flagcdn.com/w320/${code}.png 1x, https://flagcdn.com/w640/${code}.png 2x`;
  img.alt = '';
  img.className = 'geo-flag-img';
  img.loading = 'eager';
  container.appendChild(img);
}

// ── Umriss-Rendering (D3 + Topojson) ────────────────────────
let _worldAtlas = null;
let _d3Ready = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureD3() {
  if (_d3Ready) return;
  await loadScript('https://cdn.jsdelivr.net/npm/d3-geo@3/dist/d3-geo.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js');
  _d3Ready = true;
}

async function getWorldAtlas() {
  if (_worldAtlas) return _worldAtlas;
  const r = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  _worldAtlas = await r.json();
  return _worldAtlas;
}

async function renderOutlineMap(countryCode, container) {
  container.innerHTML = '<div class="geo-map-loading">Karte wird geladen…</div>';
  try {
    await ensureD3();
    const world = await getWorldAtlas();

    const country = COUNTRIES.find(c => c.code === countryCode);
    if (!country || !country.numeric) { throw new Error('kein Numerisch'); }

    const bounds = CONTINENT_BOUNDS[country.continent];
    if (!bounds) { throw new Error('kein Kontinent'); }

    const allFeatures = topojson.feature(world, world.objects.countries).features;
    const contNumerics = new Set(
      COUNTRIES.filter(c => c.continent === country.continent && c.numeric).map(c => c.numeric)
    );
    const continentFeatures = allFeatures.filter(f => contNumerics.has(+f.id));

    const w = container.clientWidth || 320;
    const h = Math.round(Math.min(w * 0.68, 220));

    const bboxFeature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[bounds.x[0], bounds.y[0]], [bounds.x[1], bounds.y[0]],
                        [bounds.x[1], bounds.y[1]], [bounds.x[0], bounds.y[1]],
                        [bounds.x[0], bounds.y[0]]]],
      },
    };

    const projection = d3.geoMercator().fitSize([w, h], bboxFeature);
    const pathGen = d3.geoPath(projection);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.cssText = 'display:block;border-radius:12px;margin:0 auto;';

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', w);
    bg.setAttribute('height', h);
    bg.setAttribute('fill', '#0a1628');
    svg.appendChild(bg);

    continentFeatures.forEach(feat => {
      const isTarget = +feat.id === country.numeric;
      const d = pathGen(feat);
      if (!d) return;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', isTarget ? '#818cf8' : '#1e3a5f');
      path.setAttribute('stroke', '#0f172a');
      path.setAttribute('stroke-width', '0.7');
      svg.appendChild(path);
    });

    container.innerHTML = '';
    container.appendChild(svg);
  } catch {
    container.innerHTML = '<p class="geo-map-error">Karte nicht verfügbar.<br>Internetzugang prüfen.</p>';
  }
}

// ── Antwort auswählen ────────────────────────────────────────
function onAnswerSelected(selectedIdx) {
  if (state.answered) return;
  state.answered = true;

  const q = state.currentQuestion;
  const buttons = document.querySelectorAll('#answers-list .answer-btn');
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) btn.classList.add('correct');
    else if (idx === selectedIdx) btn.classList.add('wrong');
  });

  const isCorrect = selectedIdx === q.correctIndex;

  if (isCorrect) {
    state.stats.correct++;
    state.stats.streak++;
    const milestone = state.stats.streak === 3 || (state.stats.streak >= 5 && state.stats.streak % 5 === 0);
    updateStat('correct');
    updateStat('streak', milestone);
    if (milestone && state.stats.streak >= 5) setTimeout(() => SoundSystem.playStreak(), 200);
    else SoundSystem.playCorrect();
    removeWrongQuestion(q);
    trackAnswer(true);
    if (state.quizMode === 'repeat') {
      const h = questionHash(q);
      state.repeatPool = state.repeatPool.filter(rq => questionHash(rq) !== h);
      state.repeatQueue = state.repeatQueue.filter(rq => questionHash(rq) !== h);
      updateRepeatProgress();
    }
  } else {
    state.stats.wrong++;
    state.stats.streak = 0;
    updateStat('wrong');
    updateStat('streak');
    SoundSystem.playWrong();
    saveWrongQuestion(q);
    trackAnswer(false);
  }

  if (state.quizMode === 'repeat') {
    const isLast = state.repeatPool.length === 0;
    document.getElementById('next-btn').disabled = false;
    document.getElementById('next-btn').textContent = isLast ? 'Ergebnis anzeigen' : 'Nächste Frage';
  } else {
    state.currentIndex++;
    const isLast = state.currentIndex >= SESSION_LENGTH || state.currentIndex >= state.questionPool.length;
    document.getElementById('next-btn').disabled = false;
    document.getElementById('next-btn').textContent = isLast ? 'Ergebnis anzeigen' : 'Nächste Frage';
  }
}

// ── Session-Ergebnis ─────────────────────────────────────────
function showSessionResult() {
  const { correct, wrong } = state.stats;
  const total = correct + wrong;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 100;

  let emoji, title, subtitle;
  if (percent >= 90)      { emoji = '🏆'; title = 'Hervorragend!';  subtitle = 'Fast perfekte Session!'; }
  else if (percent >= 75) { emoji = '🎉'; title = 'Sehr gut!';      subtitle = 'Du kennst dich aus.'; }
  else if (percent >= 60) { emoji = '👍'; title = 'Gute Leistung!'; subtitle = 'Noch ein bisschen üben.'; }
  else if (percent >= 40) { emoji = '🤔'; title = 'Weiter üben!';   subtitle = 'Du bist auf dem richtigen Weg.'; }
  else                    { emoji = '📚'; title = 'Viel zu lernen!'; subtitle = 'Bleib dabei – es wird besser!'; }

  document.getElementById('session-result-emoji').textContent = emoji;
  document.getElementById('session-result-title').textContent = title;
  document.getElementById('session-result-subtitle').textContent = subtitle;
  document.getElementById('session-result-correct').textContent = correct;
  document.getElementById('session-result-wrong').textContent = wrong;
  document.getElementById('session-result-percent').textContent = `${percent}%`;
  showScreen('screen-session-result');
}

// ── Stats-Anzeige ────────────────────────────────────────────
function resetStatDisplay() {
  ['correct', 'wrong', 'streak'].forEach(k => {
    document.getElementById(`stat-${k}`).textContent = '0';
  });
}

function updateStat(key, milestone = false) {
  const el = document.getElementById(`stat-${key}`);
  el.textContent = state.stats[key];
  const stat = el.closest('.stat');
  stat.classList.remove('bump', 'milestone');
  void stat.offsetWidth;
  if (milestone) {
    stat.classList.add('milestone');
    setTimeout(() => stat.classList.remove('milestone'), 650);
    const toast = document.getElementById('streak-toast');
    if (toast) {
      toast.textContent = `🔥 ${state.stats[key]}er Serie!`;
      toast.classList.remove('show');
      void toast.offsetWidth;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1500);
    }
  } else {
    stat.classList.add('bump');
    setTimeout(() => stat.classList.remove('bump'), 250);
  }
}

// ── Frage melden ─────────────────────────────────────────────
function wireReportGeo() {
  const btn = document.getElementById('btn-report');
  const modal = document.getElementById('report-modal');
  const cancelBtn = document.getElementById('btn-report-cancel');
  const sendBtn = document.getElementById('btn-report-send');
  let reason = null;

  btn.addEventListener('click', () => {
    if (!state.currentQuestion) return;
    reason = null;
    document.getElementById('report-comment').value = '';
    document.getElementById('report-hint').textContent = '';
    sendBtn.disabled = true;
    document.querySelectorAll('.report-reason-btn').forEach(b => b.classList.remove('selected'));
    modal.style.display = 'flex';
  });

  document.querySelectorAll('.report-reason-btn').forEach(b => {
    b.addEventListener('click', () => {
      reason = b.dataset.reason;
      document.querySelectorAll('.report-reason-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      sendBtn.disabled = false;
    });
  });

  cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  sendBtn.addEventListener('click', async () => {
    if (!reason || !state.currentQuestion) return;
    sendBtn.disabled = true;
    sendBtn.textContent = '…';
    const q = state.currentQuestion;
    const hash = questionHash(q);
    const comment = document.getElementById('report-comment').value.trim();
    try {
      await sb.from('question_reports').insert({
        question_hash: hash,
        question_text: q.question,
        topic_id: state.topicId,
        reason,
        comment: comment || null,
        status: 'open',
      });
      modal.style.display = 'none';
      showToast('Danke für deine Meldung!');
    } catch {
      document.getElementById('report-hint').textContent = 'Fehler – bitte nochmal versuchen.';
    }
    sendBtn.disabled = false;
    sendBtn.textContent = 'Senden';
  });
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadAndApplyOverrides().catch(() => {});

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = '../index.html'; return; }
  state.userId = session.user.id;

  wireReportGeo();

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  document.getElementById('btn-back-modes').addEventListener('click', () => {
    renderModeSelection();
  });

  document.getElementById('btn-back-quiz').addEventListener('click', () => {
    SoundSystem.stopBgMusic();
    const mode = GEO_MODES.find(m => m.id === state.topicId);
    if (mode) renderQuizModeSelection(mode, state.currentWrongCount);
    else renderModeSelection();
  });

  document.getElementById('btn-mode-random').addEventListener('click', startRandomQuiz);
  document.getElementById('btn-mode-repeat').addEventListener('click', startRepeatQuiz);

  document.getElementById('btn-mute').addEventListener('click', () => {
    const muted = SoundSystem.toggleMute();
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  document.getElementById('next-btn').addEventListener('click', () => {
    Ads.maybeInterstitial(renderNextQuestion);
  });

  document.getElementById('btn-play-again').addEventListener('click', () => {
    if (state.quizMode === 'repeat') startRepeatQuiz();
    else startRandomQuiz();
  });

  document.getElementById('btn-session-to-home').addEventListener('click', () => {
    renderModeSelection();
  });

  renderModeSelection();
});
