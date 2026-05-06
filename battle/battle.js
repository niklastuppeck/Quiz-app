// ============================================================
// KONFIGURATION
// ============================================================
const TIMER_SECONDS   = 15;
const NEXT_Q_DELAY_MS = 2500; // Pause zwischen Fragen

function getQuestionCount() { return battleData?.question_count || 10; }

// ============================================================
// STATE
// ============================================================
let myUserId    = null;
let myGamertag  = null;
let battleId    = null;
let battleData  = null;
let isHost      = false;
let pendingFriendId = null; // gesetzt wenn via ?friendId= geöffnet

let questions     = []; // aufgelöste Frage-Objekte
let localScores   = { me: 0, opp: 0 };
let currentAnswers = {};  // { [userId]: { is_correct, answered_at } }
let myAnsweredIdx  = null; // welchen Index ich gewählt habe

let timerInterval  = null;
let advanceTimeout = null;
let roundCountdownInterval = null;
let battleChannel  = null;
let answersChannel = null;
let awardedQuestions = new Set(); // Indizes, für die schon Punkte vergeben wurden
let opponentLeftHandled = false;

let profileCache = {}; // userId → gamertag

// ============================================================
// HILFSFUNKTIONEN
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// MODAL-HELPER (ersetzt alert/confirm)
// ============================================================
function showModal({ title, subtitle, primaryText = 'OK', secondaryText = null }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        <div class="modal-actions">
          ${secondaryText ? `<button class="btn-secondary" data-act="sec">${escapeHtml(secondaryText)}</button>` : ''}
          <button class="btn-primary" data-act="pri">${escapeHtml(primaryText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="pri"]').onclick = () => { overlay.remove(); resolve(true); };
    const sec = overlay.querySelector('[data-act="sec"]');
    if (sec) sec.onclick = () => { overlay.remove(); resolve(false); };
  });
}

function showAlert(title, subtitle) {
  return showModal({ title, subtitle, primaryText: 'OK' });
}

function showConfirm(title, subtitle) {
  return showModal({ title, subtitle, primaryText: 'Ja', secondaryText: 'Nein' });
}

// ============================================================
// HAPTIC-FEEDBACK
// ============================================================
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function getGamertag() {
  return localStorage.getItem('quiz_gamertag') || 'Du';
}

function diffLabel(d) {
  return d === 'leicht' ? '😊 Leicht'
       : d === 'mittel' ? '⚡ Mittel'
       : d === 'schwer' ? '🔥 Schwer'
       : '🎲 Mix';
}

function topicLabel(id) {
  const t = TOPICS.find(t => t.id === id);
  return t ? `${t.icon} ${t.name}` : id;
}

// Gamertag eines Users aus Cache oder DB laden
async function resolveGamertag(userId) {
  if (profileCache[userId]) return profileCache[userId];
  const { data } = await sb.from('profiles').select('gamertag').eq('user_id', userId).maybeSingle();
  const tag = data?.gamertag || '?';
  profileCache[userId] = tag;
  return tag;
}

// Server-Timestamp per RPC holen
async function getServerNow() {
  const { data } = await sb.rpc('server_now');
  return new Date(data);
}

// ============================================================
// FRAGEN-SELEKTION (Host)
// ============================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestionRefs(topicId, difficulty, count) {
  const topics = topicId === 'mix' ? TOPICS.map(t => t.id) : [topicId];

  const refs = [];
  topics.forEach(tid => {
    (QUESTIONS[tid] || []).forEach((q, idx) => {
      if (difficulty === 'mix' || q.difficulty === difficulty) {
        refs.push({ topicId: tid, qIdx: idx });
      }
    });
  });
  const picked = shuffle(refs).slice(0, count);
  if (picked.length < count) {
    const all = [];
    topics.forEach(tid => {
      (QUESTIONS[tid] || []).forEach((q, idx) => all.push({ topicId: tid, qIdx: idx }));
    });
    const extra = shuffle(all).filter(r => !picked.some(p => p.topicId === r.topicId && p.qIdx === r.qIdx));
    picked.push(...extra.slice(0, count - picked.length));
  }
  return picked;
}

function resolveQuestions(refs) {
  return refs.map(r => ({ ...QUESTIONS[r.topicId][r.qIdx], _ref: r }));
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  loadAndApplyOverrides().catch(() => {});
  const params = new URLSearchParams(window.location.search);
  battleId         = params.get('battleId');
  pendingFriendId  = params.get('friendId');

  // Session prüfen
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = '../index.html';
    return;
  }
  myUserId   = session.user.id;
  myGamertag = getGamertag();

  // Button-Events immer verdrahten
  wireButtons();

  // Sauberes Abmelden beim Tab-Close → Gegner sieht "leave" sofort statt nach ~30s
  window.addEventListener('pagehide', () => {
    if (battleChannel) battleChannel.untrack();
    unsubscribeRealtime();
  });

  // Neues Battle via friendId → Config-Screen zeigen
  if (pendingFriendId && !battleId) {
    profileCache[pendingFriendId] = await resolveGamertag(pendingFriendId);
    isHost = true;
    showConfigScreen();
    return;
  }

  if (!battleId) {
    window.location.href = '../index.html';
    return;
  }

  // Bestehendes Battle laden
  const { data: battle, error } = await sb
    .from('battles')
    .select('*')
    .eq('id', battleId)
    .maybeSingle();

  if (error || !battle) {
    await showAlert('Battle nicht gefunden', 'Die Battle existiert nicht mehr.');
    window.location.href = '../index.html';
    return;
  }

  battleData = battle;
  isHost     = (battle.host_id === myUserId);

  // Profil-Cache vorwärmen
  profileCache[battle.host_id]  = await resolveGamertag(battle.host_id);
  profileCache[battle.guest_id] = await resolveGamertag(battle.guest_id);

  // Realtime abonnieren
  subscribeRealtime();

  // Je nach Status & Rolle richtigen Screen zeigen
  await routeToScreen(battle);
});

async function routeToScreen(battle) {
  if (battle.status === 'finished') {
    // Fragen auflösen für Ergebnis-Screen
    if (battle.question_ids) questions = resolveQuestions(battle.question_ids);
    await showResultScreen(battle);
    return;
  }

  if (battle.status === 'running') {
    questions = resolveQuestions(battle.question_ids);
    showQuizScreen(battle.current_index, battle.current_started_at);
    return;
  }

  if (battle.status === 'cancelled' || battle.status === 'declined') {
    await showAlert('Battle abgesagt', 'Diese Battle wurde abgesagt.');
    window.location.href = '../index.html';
    return;
  }

  // invited oder lobby
  if (isHost) {
    if (battle.status === 'invited' && battle.topic_id) {
      // Thema+Schwierigkeit schon gesetzt (via Freundesliste) → direkt in Lobby
      await sb.from('battles').update({ status: 'lobby' }).eq('id', battleId);
      battleData = { ...battleData, status: 'lobby' };
      showLobbyScreen(battleData);
    } else if (battle.status === 'invited') {
      showSetupScreen();
    } else {
      showLobbyScreen(battle);
    }
  } else {
    // Gast: akzeptieren falls noch 'invited'
    if (battle.status === 'invited') {
      await sb.from('battles').update({ status: 'lobby' }).eq('id', battleId);
      battleData = { ...battleData, status: 'lobby' };
    }
    showLobbyScreen(battleData);
  }
}

// ============================================================
// REALTIME SUBSCRIPTIONS
// ============================================================
function subscribeRealtime() {
  // Battles-Kanal mit Presence: Statusänderungen + Online-Tracking
  battleChannel = sb.channel(`battle-${battleId}`, {
    config: { presence: { key: myUserId } }
  })
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` },
      payload => onBattleUpdate(payload.new)
    )
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key !== myUserId) onOpponentLeft();
    })
    .on('broadcast', { event: 'rematch' }, ({ payload }) => {
      window.location.href = `index.html?battleId=${payload.battleId}`;
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await battleChannel.track({ user_id: myUserId, online_at: Date.now() });
      }
    });

  // Antworten-Kanal
  answersChannel = sb.channel(`answers-${battleId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'battle_answers', filter: `battle_id=eq.${battleId}` },
      payload => onAnswerReceived(payload.new)
    )
    .subscribe();
}

async function onOpponentLeft() {
  if (opponentLeftHandled) return;
  // Wenn Spiel schon beendet/abgesagt, ist ein Verlassen normal
  if (!battleData || battleData.status === 'finished' ||
      battleData.status === 'cancelled' || battleData.status === 'declined') return;

  opponentLeftHandled = true;
  stopTimer();
  clearAdvanceTimeout();

  // Host markiert das Battle als abgesagt (Gast hat keine Schreibrechte auf Status nicht garantiert,
  // aber wir versuchen es trotzdem — bei Fehler ignorieren)
  try {
    await sb.from('battles').update({ status: 'cancelled' }).eq('id', battleId);
  } catch (_) {}

  unsubscribeRealtime();
  await showAlert('Gegner hat verlassen', 'Die Battle wurde beendet.');
  window.location.href = '../index.html';
}

function unsubscribeRealtime() {
  if (battleChannel)  { sb.removeChannel(battleChannel);  battleChannel  = null; }
  if (answersChannel) { sb.removeChannel(answersChannel); answersChannel = null; }
}

// ============================================================
// BATTLE-UPDATE (Realtime)
// ============================================================
async function onBattleUpdate(newBattle) {
  const prev = battleData;
  battleData = newBattle;

  if (newBattle.status === 'cancelled' || newBattle.status === 'declined') {
    stopTimer();
    clearAdvanceTimeout();
    unsubscribeRealtime();
    await showAlert('Battle beendet', 'Die Battle wurde abgesagt.');
    window.location.href = '../index.html';
    return;
  }

  if (newBattle.status === 'finished') {
    stopTimer();
    clearAdvanceTimeout();
    await showResultScreen(newBattle);
    return;
  }

  // Lobby-Updates (ready-Flags, Gast hat angenommen)
  const currentScreenId = document.querySelector('.screen.active')?.id;
  if (currentScreenId === 'screen-lobby' || currentScreenId === 'screen-setup') {
    updateLobbyReady(newBattle);
    if (newBattle.status === 'running') {
      questions = resolveQuestions(newBattle.question_ids);
      showQuizScreen(newBattle.current_index, newBattle.current_started_at);
    }
    return;
  }

  if (newBattle.status === 'running') {
    if (currentScreenId !== 'screen-quiz') {
      questions = resolveQuestions(newBattle.question_ids);
      showQuizScreen(newBattle.current_index, newBattle.current_started_at);
      return;
    }

    // Neue Frage
    if (newBattle.current_index !== prev?.current_index) {
      // Fallback: Punkt vergeben, falls Realtime-Antwort verspätet eintrifft.
      // awardPointForQuestion ist via awardedQuestions idempotent.
      awardPointForQuestion(currentAnswers, prev?.current_index);
      updateScoreDisplay();

      currentAnswers = {};
      myAnsweredIdx  = null;
      clearAdvanceTimeout();
      hideRoundOverlay();
      showQuizScreen(newBattle.current_index, newBattle.current_started_at);
    }
  }
}

// ============================================================
// ANTWORT EMPFANGEN (Realtime)
// ============================================================
async function onAnswerReceived(answer) {
  // Ignorieren wenn falsche Frage (verzögerter Event)
  if (answer.question_index !== battleData?.current_index) return;

  currentAnswers[answer.user_id] = answer;
  updateOpponentStrip(answer);

  const bothAnswered = !!currentAnswers[battleData.host_id] && !!currentAnswers[battleData.guest_id];

  if (bothAnswered) {
    // Beide Clients berechnen den Punktsieger (deterministisch, gleicher Input)
    awardPointForQuestion(currentAnswers);
    updateScoreDisplay();

    if (isHost) {
      clearAdvanceTimeout();
      advanceTimeout = setTimeout(advanceQuestion, NEXT_Q_DELAY_MS);
    }
  }
}

// ============================================================
// SETUP SCREEN (Host)
// ============================================================
let selectedTopic = null;
let selectedDiff  = null;
let selectedCount = null;
let selectedMode  = null;

function showConfigScreen() {
  document.getElementById('battle-subtitle').textContent = 'Battle einrichten';
  selectedCount = null;
  selectedMode  = null;
  document.querySelectorAll('.battle-count-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.battle-mode-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('btn-config-next').disabled = false;
  document.getElementById('config-hint').textContent = '';
  showScreen('screen-config');
}

function checkConfigReady() {
  if (selectedCount && selectedMode) {
    document.getElementById('config-hint').textContent = '';
  }
}

function showSetupScreen() {
  document.getElementById('battle-subtitle').textContent = 'Neue Herausforderung';
  showScreen('screen-setup');

  const grid = document.getElementById('battle-topic-grid');
  grid.innerHTML = '';

  // Mix als erste Option
  const mixBtn = document.createElement('button');
  mixBtn.className = 'battle-topic-btn';
  mixBtn.dataset.id = 'mix';
  mixBtn.innerHTML = `<span>🎲</span><span>Mix</span>`;
  mixBtn.addEventListener('click', () => selectTopic('mix', mixBtn));
  grid.appendChild(mixBtn);

  const allTopics = [...TOPICS, ...(typeof GEO_TOPICS !== 'undefined' ? GEO_TOPICS : [])];
  allTopics.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'battle-topic-btn';
    btn.dataset.id = t.id;
    btn.innerHTML = `<span>${t.icon}</span><span>${t.name}</span>`;
    btn.style.setProperty('--topic-color', t.color);
    btn.addEventListener('click', () => selectTopic(t.id, btn));
    grid.appendChild(btn);
  });

  selectedTopic = null;
  selectedDiff  = null;
  document.querySelectorAll('.battle-diff-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('btn-send-challenge').disabled = true;
}

function selectTopic(id, btn) {
  document.querySelectorAll('.battle-topic-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedTopic = id;
  checkSetupReady();
}

function checkSetupReady() {
  document.getElementById('btn-send-challenge').disabled = !(selectedTopic && selectedDiff);
}

async function onSendChallenge() {
  const btn  = document.getElementById('btn-send-challenge');
  const hint = document.getElementById('setup-hint');
  btn.disabled    = true;
  btn.textContent = '…';

  const friendId = pendingFriendId || battleData?.guest_id;

  const { data: newBattle, error } = await sb.from('battles').insert({
    host_id:        myUserId,
    guest_id:       friendId,
    topic_id:       selectedTopic,
    difficulty:     selectedDiff,
    question_count: selectedCount,
    score_mode:     selectedMode,
    status:         'lobby',
  }).select().maybeSingle();

  btn.textContent = 'Herausforderung senden ⚔️';

  if (error || !newBattle) {
    hint.textContent = 'Fehler: ' + (error?.message || 'Unbekannt');
    hint.style.display = '';
    btn.disabled = false;
    return;
  }

  battleId   = newBattle.id;
  battleData = newBattle;
  pendingFriendId = null;

  // Profil-Cache für Gast sicherstellen
  if (!profileCache[friendId]) profileCache[friendId] = await resolveGamertag(friendId);

  // URL aktualisieren ohne Seitenreload
  window.history.replaceState({}, '', `?battleId=${battleId}`);

  subscribeRealtime();
  showLobbyScreen(battleData);
}

// ============================================================
// LOBBY SCREEN
// ============================================================
async function showLobbyScreen(battle) {
  document.getElementById('battle-subtitle').textContent = 'Lobby';

  if (!profileCache[battle.host_id])  profileCache[battle.host_id]  = myGamertag;
  if (!profileCache[battle.guest_id]) profileCache[battle.guest_id] = myGamertag;
  const hostTag  = profileCache[battle.host_id]  || '?';
  const guestTag = profileCache[battle.guest_id] || '?';

  document.getElementById('lobby-host-avatar').textContent = hostTag.charAt(0).toUpperCase();
  document.getElementById('lobby-guest-avatar').textContent = guestTag.charAt(0).toUpperCase();
  document.getElementById('lobby-host-name').textContent = hostTag;
  document.getElementById('lobby-guest-name').textContent = guestTag;

  document.getElementById('lobby-topic-tag').textContent = battle.topic_id ? topicLabel(battle.topic_id) : '–';
  document.getElementById('lobby-diff-tag').textContent  = battle.difficulty ? diffLabel(battle.difficulty) : '–';

  showScreen('screen-lobby');
  updateLobbyReady(battle);
}

function updateLobbyReady(battle) {
  const hostReady  = battle.host_ready;
  const guestReady = battle.guest_ready;

  document.getElementById('lobby-host-ready').textContent  = hostReady  ? '✅ Bereit' : '⏳ Wartet';
  document.getElementById('lobby-guest-ready').textContent = guestReady ? '✅ Bereit' : '⏳ Wartet';
  document.getElementById('lobby-host-ready').classList.toggle('ready', hostReady);
  document.getElementById('lobby-guest-ready').classList.toggle('ready', guestReady);

  // Gast noch nicht angekommen
  const guestTag = profileCache[battle.guest_id];
  if (battle.status === 'lobby') {
    document.getElementById('lobby-guest-name').textContent = guestTag || '?';
  }

  if (isHost) {
    const readyBtn  = document.getElementById('btn-ready');
    const startBtn  = document.getElementById('btn-start-game');

    if (!hostReady) {
      readyBtn.style.display = '';
      startBtn.style.display = 'none';
      document.getElementById('lobby-hint').textContent = 'Drücke "Bereit", wenn du bereit bist.';
    } else if (!guestReady) {
      readyBtn.style.display = 'none';
      startBtn.style.display = 'none';
      document.getElementById('lobby-hint').textContent = `Warte auf ${guestTag || 'Gegner'}…`;
    } else {
      readyBtn.style.display = 'none';
      startBtn.style.display = '';
      document.getElementById('lobby-hint').textContent = 'Beide bereit – starte die Runde!';
    }
  } else {
    // Gast
    const readyBtn = document.getElementById('btn-ready');
    document.getElementById('btn-start-game').style.display = 'none';
    if (!guestReady) {
      readyBtn.style.display = '';
      document.getElementById('lobby-hint').textContent = 'Drücke "Bereit", wenn du bereit bist.';
    } else {
      readyBtn.style.display = 'none';
      document.getElementById('lobby-hint').textContent = 'Warte auf den Host…';
    }
  }

  // Thema/Diff nachladen falls noch leer
  if (battle.topic_id) {
    document.getElementById('lobby-topic-tag').textContent = topicLabel(battle.topic_id);
    document.getElementById('lobby-diff-tag').textContent  = diffLabel(battle.difficulty);
  }
}

async function onReady() {
  const field = isHost ? 'host_ready' : 'guest_ready';
  document.getElementById('btn-ready').disabled = true;
  await sb.from('battles').update({ [field]: true }).eq('id', battleId);
  document.getElementById('btn-ready').style.display = 'none';
}

async function onStartGame() {
  document.getElementById('btn-start-game').disabled = true;
  document.getElementById('btn-start-game').textContent = '…';

  // Fragen auswählen
  const refs = pickQuestionRefs(battleData.topic_id, battleData.difficulty, getQuestionCount());
  questions  = resolveQuestions(refs);

  // Server-Zeit holen, Start in 3 Sekunden
  const serverNow    = await getServerNow();
  const startAt      = new Date(serverNow.getTime() + 3000).toISOString();

  const { error } = await sb.from('battles').update({
    status:              'running',
    question_ids:        refs,
    current_index:       0,
    current_started_at:  startAt,
    total_questions:     getQuestionCount(),
  }).eq('id', battleId);

  if (error) {
    document.getElementById('btn-start-game').disabled = false;
    document.getElementById('btn-start-game').textContent = '▶ Spiel starten';
    await showAlert('Fehler', error.message);
  }
}

// ============================================================
// QUIZ SCREEN
// ============================================================
function showQuizScreen(qIdx, startedAt) {
  document.getElementById('battle-subtitle').textContent = 'Battle';
  showScreen('screen-quiz');

  const oppId  = isHost ? battleData.guest_id : battleData.host_id;
  const oppTag = profileCache[oppId] || 'Gegner';
  document.getElementById('battle-opp-name').textContent = oppTag;
  document.getElementById('battle-opp-status').textContent = 'überlegt…';
  document.getElementById('battle-opp-status').className = 'battle-opp-status';

  updateScoreDisplay();
  renderQuestion(qIdx, startedAt);
}

function renderQuestion(qIdx, startedAt) {
  const q = questions[qIdx];
  if (!q) return;

  document.getElementById('battle-counter').textContent = `${qIdx + 1} / ${getQuestionCount()}`;

  const imgContainer = document.getElementById('battle-question-image');
  const questionText = document.getElementById('battle-question-text');
  imgContainer.innerHTML = '';
  imgContainer.style.display = 'none';
  questionText.textContent = '';

  if (q.question.startsWith('__geo_flag__:')) {
    const code = q.question.slice('__geo_flag__:'.length).toLowerCase();
    const img = document.createElement('img');
    img.className = 'geo-flag-img';
    img.src = `https://flagcdn.com/w320/${code}.png`;
    img.srcset = `https://flagcdn.com/w640/${code}.png 2x`;
    img.alt = '';
    imgContainer.appendChild(img);
    imgContainer.style.display = '';
    questionText.textContent = 'Welches Land zeigt diese Flagge?';
  } else if (q.question.startsWith('__geo_outline__:')) {
    const code = q.question.slice('__geo_outline__:'.length);
    imgContainer.style.display = '';
    questionText.textContent = 'Welches Land zeigt dieser Umriss?';
    battleRenderOutline(code, imgContainer);
  } else {
    questionText.textContent = q.question;
  }

  const list = document.getElementById('battle-answers-list');
  list.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.answers.forEach((ans, idx) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.innerHTML = `<span class="answer-letter">${letters[idx]}</span><span class="answer-text">${escapeHtml(ans)}</span>`;
    btn.addEventListener('click', () => onAnswer(idx, q));
    list.appendChild(btn);
  });

  // Timer starten – synchronisiert mit current_started_at
  startSyncedTimer(startedAt);
}

// ── Geo rendering for Battle ──
let _d3Promise = null;
let _atlasPromise = null;

function battleEnsureD3() {
  if (_d3Promise) return _d3Promise;
  _d3Promise = new Promise((resolve, reject) => {
    if (window.d3 && window.topojson) { resolve(); return; }
    const s1 = document.createElement('script');
    s1.src = 'https://cdn.jsdelivr.net/npm/d3-geo@3/dist/d3-geo.umd.min.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js';
      s2.onload = resolve;
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
  return _d3Promise;
}

function battleGetWorldAtlas() {
  if (_atlasPromise) return _atlasPromise;
  _atlasPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then(r => r.json());
  return _atlasPromise;
}

const BATTLE_CONTINENT_BOUNDS = {
  europa:       { x: [-25, 45],   y: [30, 73]  },
  asien:        { x: [25, 150],   y: [-15, 77] },
  afrika:       { x: [-20, 52],   y: [-36, 38] },
  nordamerika:  { x: [-170, -52], y: [5, 84]   },
  suedamerika:  { x: [-82, -34],  y: [-56, 14] },
  ozeanien:     { x: [110, 180],  y: [-48, 5]  },
};

async function battleRenderOutline(code, container) {
  const loading = document.createElement('div');
  loading.className = 'geo-map-loading';
  loading.textContent = '🗺️ Lade Karte…';
  container.appendChild(loading);

  try {
    await battleEnsureD3();
    const world = await battleGetWorldAtlas();

    const country = (typeof COUNTRIES !== 'undefined') && COUNTRIES.find(c => c.code === code);
    if (!country || !country.numeric) throw new Error('no numeric');

    const continent = country.continent;
    const bounds = BATTLE_CONTINENT_BOUNDS[continent] || { x: [-180, 180], y: [-90, 90] };
    const [[x0, x1], [y0, y1]] = [bounds.x, bounds.y];

    const W = 360, H = 240;
    const bbox = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]] } };
    const projection = d3.geoMercator().fitSize([W, H], bbox);
    const path = d3.geoPath(projection);

    const allFeatures = topojson.feature(world, world.objects.countries).features;
    const targetFeature = allFeatures.find(f => +f.id === +country.numeric);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.className.baseVal = 'geo-map-svg';

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', '#0a1628');
    svg.appendChild(bg);

    const continentNumerics = new Set(
      (typeof COUNTRIES !== 'undefined' ? COUNTRIES : [])
        .filter(c => c.continent === continent && c.numeric)
        .map(c => +c.numeric)
    );

    allFeatures.forEach(f => {
      if (!continentNumerics.has(+f.id)) return;
      const d = path(f);
      if (!d) return;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', d);
      el.setAttribute('fill', +f.id === +country.numeric ? '#818cf8' : '#1e3a5f');
      el.setAttribute('stroke', '#0a1628');
      el.setAttribute('stroke-width', '0.5');
      svg.appendChild(el);
    });

    container.innerHTML = '';
    container.appendChild(svg);
  } catch (e) {
    container.innerHTML = '<div class="geo-map-error">Karte nicht verfügbar</div>';
  }
}

function startSyncedTimer(startedAtIso) {
  stopTimer();

  const startedAt  = new Date(startedAtIso).getTime();
  const elapsed    = Math.floor((Date.now() - startedAt) / 1000);
  let timeLeft     = Math.max(0, TIMER_SECONDS - elapsed);

  const bar  = document.getElementById('battle-timer-bar');
  const fill = document.getElementById('battle-timer-fill');
  const text = document.getElementById('battle-timer-text');

  bar.classList.remove('warning');
  text.textContent = timeLeft;

  // Balken-Animation von aktuellem Stand
  fill.style.transition = 'none';
  fill.style.transform  = `scaleX(${timeLeft / TIMER_SECONDS})`;
  void fill.offsetWidth;
  fill.style.transition = `transform ${timeLeft}s linear`;
  fill.style.transform  = 'scaleX(0)';

  if (timeLeft <= 0) { onTimeout(); return; }

  timerInterval = setInterval(() => {
    timeLeft--;
    text.textContent = timeLeft;
    if (timeLeft <= 5) bar.classList.add('warning');
    if (timeLeft <= 0) {
      stopTimer();
      onTimeout();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  document.getElementById('battle-timer-bar')?.classList.remove('warning');
}

async function onAnswer(selectedIdx, q) {
  if (myAnsweredIdx !== null) return; // schon geantwortet
  myAnsweredIdx = selectedIdx;
  stopTimer();
  SoundSystem._resumeCtx();

  const isCorrect = selectedIdx === q.correctIndex;
  if (isCorrect) { SoundSystem.playCorrect(); vibrate(50); }
  else           { SoundSystem.playWrong();   vibrate([100, 50, 100]); }

  // Buttons sperren und markieren
  const btns = document.querySelectorAll('#battle-answers-list .answer-btn');
  btns.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) btn.classList.add('correct');
    else if (idx === selectedIdx && !isCorrect) btn.classList.add('wrong');
  });

  // In DB speichern (answered_at kommt vom Server = fair)
  await sb.from('battle_answers').insert({
    battle_id:      battleId,
    question_index: battleData.current_index,
    user_id:        myUserId,
    answer_index:   selectedIdx,
    is_correct:     isCorrect,
  });

  // Punkt-Vergabe & Advance laufen über onAnswerReceived (Echo der eigenen Antwort)
}

async function onTimeout() {
  if (myAnsweredIdx !== null) return;
  myAnsweredIdx = -1; // -1 = Timeout

  const q    = questions[battleData.current_index];
  const btns = document.querySelectorAll('#battle-answers-list .answer-btn');
  btns.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) btn.classList.add('correct');
  });

  SoundSystem.playWrong();
  vibrate([100, 50, 100]);

  // Timeout in DB schreiben → Gegner sieht bothAnswered und kriegt das Overlay.
  // Punkt-Vergabe & Advance laufen wieder über onAnswerReceived (idempotent).
  await sb.from('battle_answers').insert({
    battle_id:      battleId,
    question_index: battleData.current_index,
    user_id:        myUserId,
    answer_index:   -1,
    is_correct:     false,
  });
}

function updateOpponentStrip(answer) {
  const oppId = isHost ? battleData.guest_id : battleData.host_id;
  if (answer.user_id !== oppId) return;

  const strip  = document.getElementById('battle-opp-status');
  if (answer.is_correct) {
    strip.textContent = '✅ Richtig!';
    strip.className   = 'battle-opp-status opp-correct';
  } else {
    strip.textContent = '❌ Falsch';
    strip.className   = 'battle-opp-status opp-wrong';
  }
}

// ============================================================
// SCORE-BERECHNUNG (lokal, deterministisch)
// ============================================================
function updateScoreDisplay() {
  document.getElementById('battle-score-me').textContent  = localScores.me;
  document.getElementById('battle-score-opp').textContent = localScores.opp;
}

function awardPointForQuestion(answers, qIdx = battleData?.current_index) {
  if (qIdx == null || awardedQuestions.has(qIdx)) return;
  awardedQuestions.add(qIdx);

  const correct = Object.values(answers).filter(a => a.is_correct);
  if (correct.length === 0) {
    showRoundOverlay('Niemand', null);
    return;
  }

  const mode = battleData?.score_mode || 'fastest';

  if (mode === 'both') {
    let iGotPoint = false;
    correct.forEach(a => {
      if (a.user_id === myUserId) { localScores.me++; iGotPoint = true; }
      else localScores.opp++;
    });
    showRoundOverlay('Du', iGotPoint ? true : false);
  } else {
    correct.sort((a, b) => new Date(a.answered_at) - new Date(b.answered_at));
    const winner = correct[0].user_id;
    if (winner === myUserId) {
      localScores.me++;
      showRoundOverlay('Du', true);
    } else {
      localScores.opp++;
      const oppTag = profileCache[winner] || 'Gegner';
      showRoundOverlay(oppTag, false);
    }
  }
  updateScoreDisplay();
}

// ============================================================
// RUNDEN-OVERLAY (zwischen Fragen)
// ============================================================
function showRoundOverlay(winnerLabel, isMine) {
  const overlay  = document.getElementById('battle-round-overlay');
  const result   = document.getElementById('battle-round-result');
  const countdown = document.getElementById('battle-round-countdown');

  let html;
  if (isMine === null) {
    html = '<span class="round-no-point">Niemand bekommt einen Punkt</span>';
  } else if (isMine) {
    html = '<span class="round-winner-me">+1 Punkt für dich! ✅</span>';
  } else {
    html = `<span class="round-winner-opp">+1 Punkt für ${escapeHtml(winnerLabel)} ❌</span>`;
  }

  result.innerHTML   = html;
  countdown.textContent = '';
  overlay.style.display = '';

  if (roundCountdownInterval) clearInterval(roundCountdownInterval);
  let tick = Math.ceil(NEXT_Q_DELAY_MS / 1000);
  countdown.textContent = `Nächste Frage in ${tick}…`;
  roundCountdownInterval = setInterval(() => {
    tick--;
    if (tick <= 0) {
      clearInterval(roundCountdownInterval);
      roundCountdownInterval = null;
      countdown.textContent = '';
      return;
    }
    countdown.textContent = `Nächste Frage in ${tick}…`;
  }, 1000);
}

function hideRoundOverlay() {
  if (roundCountdownInterval) {
    clearInterval(roundCountdownInterval);
    roundCountdownInterval = null;
  }
  document.getElementById('battle-round-overlay').style.display = 'none';
  document.getElementById('battle-round-result').innerHTML = '';
}

// ============================================================
// FRAGE VORWÄRTS (nur Host)
// ============================================================
async function reconcileScoresFromDb() {
  const { data, error } = await sb
    .from('battle_answers')
    .select('user_id, question_index, is_correct, answered_at')
    .eq('battle_id', battleId);
  if (error || !data) return null;

  const byQ = {};
  data.forEach(a => {
    (byQ[a.question_index] = byQ[a.question_index] || []).push(a);
  });

  const mode = battleData?.score_mode || 'fastest';
  let host = 0, guest = 0;
  Object.values(byQ).forEach(answers => {
    const correct = answers.filter(a => a.is_correct);
    if (correct.length === 0) return;
    if (mode === 'both') {
      correct.forEach(a => {
        if (a.user_id === battleData.host_id) host++;
        else if (a.user_id === battleData.guest_id) guest++;
      });
    } else {
      correct.sort((a, b) => new Date(a.answered_at) - new Date(b.answered_at));
      const winner = correct[0].user_id;
      if (winner === battleData.host_id) host++;
      else if (winner === battleData.guest_id) guest++;
    }
  });
  return { host, guest };
}

async function advanceQuestion() {
  if (!isHost) return;

  const nextIdx = battleData.current_index + 1;

  if (nextIdx >= getQuestionCount()) {
    // Scores aus DB rekonstruieren — Wahrheit, falls Realtime-Hiccup
    const reconciled = await reconcileScoresFromDb();
    const hostScore  = reconciled ? reconciled.host  : localScores.me;
    const guestScore = reconciled ? reconciled.guest : localScores.opp;

    await sb.from('battles').update({
      status:       'finished',
      host_score:   hostScore,
      guest_score:  guestScore,
      finished_at:  new Date().toISOString(),
    }).eq('id', battleId);
    return;
  }

  const serverNow = await getServerNow();
  const startAt   = new Date(serverNow.getTime() + 2500).toISOString();

  await sb.from('battles').update({
    current_index:      nextIdx,
    current_started_at: startAt,
  }).eq('id', battleId);
}

function clearAdvanceTimeout() {
  if (advanceTimeout) { clearTimeout(advanceTimeout); advanceTimeout = null; }
}

// ============================================================
// ERGEBNIS SCREEN
// ============================================================
async function showResultScreen(battle) {
  stopTimer();
  clearAdvanceTimeout();
  unsubscribeRealtime();

  const hostTag = profileCache[battle.host_id]  || await resolveGamertag(battle.host_id);
  const guestTag = profileCache[battle.guest_id] || await resolveGamertag(battle.guest_id);

  const myScore  = isHost ? battle.host_score  : battle.guest_score;
  const oppScore = isHost ? battle.guest_score : battle.host_score;
  const oppTag   = isHost ? guestTag : hostTag;

  document.getElementById('result-me-name').textContent  = myGamertag;
  document.getElementById('result-opp-name').textContent = oppTag;
  document.getElementById('result-me-score').textContent  = myScore ?? localScores.me;
  document.getElementById('result-opp-score').textContent = oppScore ?? localScores.opp;

  let emoji, title, subtitle;
  const me  = myScore  ?? localScores.me;
  const opp = oppScore ?? localScores.opp;

  const meCard  = document.getElementById('result-me-card');
  const oppCard = document.getElementById('result-opp-card');
  const meBadge  = document.getElementById('result-me-badge');
  const oppBadge = document.getElementById('result-opp-badge');
  meCard.classList.remove('winner', 'loser', 'draw');
  oppCard.classList.remove('winner', 'loser', 'draw');

  if (me > opp) {
    emoji = '🏆'; title = 'Du gewinnst!'; subtitle = `${me} : ${opp} – starke Leistung!`;
    meCard.classList.add('winner'); oppCard.classList.add('loser');
    meBadge.textContent = '🏆 Sieg'; oppBadge.textContent = '';
  } else if (me < opp) {
    emoji = '😤'; title = 'Niederlage!'; subtitle = `${me} : ${opp} – beim nächsten Mal!`;
    oppCard.classList.add('winner'); meCard.classList.add('loser');
    oppBadge.textContent = '🏆 Sieg'; meBadge.textContent = '';
  } else {
    emoji = '🤝'; title = 'Unentschieden!'; subtitle = `${me} : ${opp} – zu ebenbürtig!`;
    meCard.classList.add('draw'); oppCard.classList.add('draw');
    meBadge.textContent = '🤝'; oppBadge.textContent = '🤝';
  }

  document.getElementById('battle-result-emoji').textContent    = emoji;
  document.getElementById('battle-result-title').textContent    = title;
  document.getElementById('battle-result-subtitle').textContent = subtitle;
  document.getElementById('battle-subtitle').textContent        = 'Ergebnis';

  showScreen('screen-result');
}

// ============================================================
// REMATCH
// ============================================================
async function onRematch() {
  const btn = document.getElementById('btn-rematch');
  btn.disabled = true;
  btn.textContent = '…';

  const oppId = isHost ? battleData.guest_id : battleData.host_id;

  const { data: newBattle, error } = await sb.from('battles').insert({
    host_id:        myUserId,
    guest_id:       oppId,
    topic_id:       battleData.topic_id,
    difficulty:     battleData.difficulty,
    question_count: battleData.question_count,
    score_mode:     battleData.score_mode,
    status:         'lobby',
  }).select().maybeSingle();

  if (error || !newBattle) {
    btn.disabled = false;
    btn.textContent = '🔁 Nochmal';
    await showAlert('Fehler', 'Rematch konnte nicht erstellt werden.');
    return;
  }

  // Gegner über bestehenden Kanal direkt benachrichtigen, kurz warten damit der Server relayed
  await battleChannel.send({
    type:    'broadcast',
    event:   'rematch',
    payload: { battleId: newBattle.id },
  });
  await new Promise(r => setTimeout(r, 250));

  window.location.href = `index.html?battleId=${newBattle.id}`;
}

// ============================================================
// BUTTON-EVENTS
// ============================================================
function wireButtons() {
  const muteBtn = document.getElementById('btn-battle-mute');
  muteBtn.addEventListener('click', () => {
    const muted = SoundSystem.toggleMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  document.getElementById('btn-config-back').addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  document.getElementById('btn-config-next').addEventListener('click', () => {
    const hint = document.getElementById('config-hint');
    const countSection = document.getElementById('config-section-count');
    const modeSection  = document.getElementById('config-section-mode');

    if (!selectedCount && !selectedMode) {
      hint.textContent = 'Bitte wähle zuerst die Anzahl der Fragen und den Wertungsmodus.';
      countSection.classList.add('config-section-missing');
      modeSection.classList.add('config-section-missing');
      setTimeout(() => {
        countSection.classList.remove('config-section-missing');
        modeSection.classList.remove('config-section-missing');
      }, 1000);
      return;
    }
    if (!selectedCount) {
      hint.textContent = 'Wie viele Fragen soll die Runde haben?';
      countSection.classList.add('config-section-missing');
      setTimeout(() => countSection.classList.remove('config-section-missing'), 1000);
      return;
    }
    if (!selectedMode) {
      hint.textContent = 'Bitte noch den Wertungsmodus auswählen.';
      modeSection.classList.add('config-section-missing');
      setTimeout(() => modeSection.classList.remove('config-section-missing'), 1000);
      return;
    }

    hint.textContent = '';
    showSetupScreen();
  });

  document.getElementById('btn-setup-back').addEventListener('click', () => {
    showConfigScreen();
  });

  document.getElementById('btn-lobby-back').addEventListener('click', async () => {
    if (await showConfirm('Battle abbrechen?', 'Die Battle wird für beide Spieler beendet.')) {
      await sb.from('battles').update({ status: 'cancelled' }).eq('id', battleId);
      window.location.href = '../index.html';
    }
  });

  document.querySelectorAll('.battle-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.battle-diff-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDiff = btn.dataset.diff;
      checkSetupReady();
    });
  });

  document.querySelectorAll('.battle-count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.battle-count-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCount = parseInt(btn.dataset.count);
      checkConfigReady();
    });
  });

  document.querySelectorAll('.battle-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.battle-mode-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMode = btn.dataset.mode;
      checkConfigReady();
    });
  });

  document.getElementById('btn-send-challenge').addEventListener('click', onSendChallenge);
  document.getElementById('btn-ready').addEventListener('click', onReady);
  document.getElementById('btn-start-game').addEventListener('click', onStartGame);

  document.getElementById('btn-rematch').addEventListener('click', onRematch);
  document.getElementById('btn-result-home').addEventListener('click', () => {
    window.location.href = '../index.html';
  });
}
