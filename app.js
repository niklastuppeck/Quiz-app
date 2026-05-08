const GEO_TOPIC_DEFS = [
  { id: 'geo_flaggen',      name: 'Flaggen',     icon: '🚩',  color: '#10b981' },
  { id: 'geo_hauptstaedte', name: 'Hauptstädte', icon: '🏛️', color: '#06b6d4' },
  { id: 'geo_umrisse',      name: 'Umrisse',     icon: '🗺️', color: '#8b5cf6' },
];

// ============================================================
// STREAK HELPERS
// ============================================================
function localDateString(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getActiveStreak() {
  const streak = parseInt(localStorage.getItem('quiz_streak') || '0', 10);
  const lastDate = localStorage.getItem('quiz_streak_date') || '';
  if (!streak || !lastDate) return 0;
  // Streak ist aktiv wenn heute oder gestern gespielt wurde
  if (lastDate === localDateString(0) || lastDate === localDateString(-1)) return streak;
  // Abgelaufen — zurücksetzen
  localStorage.setItem('quiz_streak', '0');
  return 0;
}

// E-Mail während der Registrierung zwischenspeichern
let currentRegEmail = '';
// Aktueller Auth-Flow: 'register' oder 'reset'
let currentFlow = 'register';

// ============================================================
// CLEANUP & AUTO-REFRESH
// Alle Timer/Listener, die zu einem Screen gehören, werden hier
// registriert und bei jedem Screen-Wechsel automatisch entfernt.
// ============================================================
const cleanupTasks = [];
function registerCleanup(fn) { cleanupTasks.push(fn); }
function runCleanup() {
  while (cleanupTasks.length) {
    try { cleanupTasks.pop()(); } catch (e) { console.error('Cleanup error:', e); }
  }
}

// Hilfsfunktion: ruft refreshFn periodisch auf und sofort, wenn
// der Tab wieder sichtbar wird oder das Fenster Fokus bekommt.
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

// Cooldown für "Code erneut senden"
let resendCooldownTimer = null;
function startResendCooldown(seconds) {
  const btn = document.getElementById('btn-resend-code');
  if (!btn) return;
  let remaining = seconds;
  btn.disabled = true;
  btn.textContent = `Erneut senden in ${remaining}s`;
  if (resendCooldownTimer) clearInterval(resendCooldownTimer);
  registerCleanup(() => {
    if (resendCooldownTimer) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
    }
  });
  resendCooldownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
      btn.disabled = false;
      btn.textContent = 'Code erneut senden';
    } else {
      btn.textContent = `Erneut senden in ${remaining}s`;
    }
  }, 1000);
}

// ============================================================
// HILFSFUNKTIONEN
// ============================================================
function showScreen(id) {
  runCleanup();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setHint(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? '…' : label;
}

function getGamertag() {
  return localStorage.getItem('quiz_gamertag');
}

function saveGamertag(name) {
  localStorage.setItem('quiz_gamertag', name);
}

function showSettingsBtn(visible) {
  document.getElementById('btn-settings').style.display = visible ? '' : 'none';
}

// ============================================================
// LOGIN
// ============================================================
async function onLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    setHint('login-hint', 'Bitte E-Mail und Passwort eingeben.', true);
    return;
  }

  setLoading('btn-login', true, 'Anmelden');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  setLoading('btn-login', false, 'Anmelden');

  if (error) {
    setHint('login-hint', 'E-Mail oder Passwort falsch.', true);
    return;
  }

  afterLogin(data.user);
}

// ============================================================
// REGISTRIERUNG — Schritt 1: E-Mail → Code senden
// ============================================================
async function onSendCode() {
  const email = document.getElementById('reg-email').value.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setHint('reg-email-hint', 'Bitte eine gültige E-Mail eingeben.', true);
    return;
  }

  setLoading('btn-send-code', true, 'Code senden');

  if (currentFlow === 'reset') {
    // Passwort vergessen: User muss existieren
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });
    setLoading('btn-send-code', false, 'Code senden');

    if (error) {
      setHint('reg-email-hint', 'Diese E-Mail ist nicht registriert.', true);
      return;
    }
  } else {
    // Registrierung: erst prüfen ob User schon existiert
    const { error: existsError } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });

    if (!existsError) {
      setLoading('btn-send-code', false, 'Code senden');
      setHint('reg-email-hint', 'Diese E-Mail ist bereits registriert. Bitte melde dich an.', true);
      document.getElementById('login-email').value = email;
      document.getElementById('login-password').value = '';
      setHint('login-hint', 'Diese E-Mail ist bereits registriert — bitte einloggen.', false);
      showScreen('screen-auth');
      return;
    }

    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    });
    setLoading('btn-send-code', false, 'Code senden');

    if (error) {
      setHint('reg-email-hint', 'Fehler: ' + error.message, true);
      return;
    }
  }

  currentRegEmail = email;
  document.getElementById('reg-code-subtitle').textContent =
    `Wir haben einen 8-stelligen Code an ${email} geschickt.`;
  setHint('reg-code-hint', '', false);
  document.getElementById('reg-code').value = '';
  showScreen('screen-reg-code');
  startResendCooldown(60);
}

// ============================================================
// REGISTRIERUNG — Schritt 2: Code bestätigen
// ============================================================
async function onVerifyCode() {
  const token = document.getElementById('reg-code').value.trim();

  if (!/^\d{8}$/.test(token)) {
    setHint('reg-code-hint', 'Bitte den 8-stelligen Code eingeben.', true);
    return;
  }

  setLoading('btn-verify-code', true, 'Bestätigen');
  const { data, error } = await sb.auth.verifyOtp({
    email: currentRegEmail,
    token,
    type: 'email'
  });
  setLoading('btn-verify-code', false, 'Bestätigen');

  if (error) {
    setHint('reg-code-hint', 'Ungültiger oder abgelaufener Code.', true);
    return;
  }

  if (currentFlow === 'reset') {
    setHint('reg-password-hint', '', false);
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-password2').value = '';
    showScreen('screen-reg-password');
    return;
  }

  const gamertag = data.user?.user_metadata?.gamertag;
  if (gamertag) {
    saveGamertag(gamertag);
    showHome();
  } else {
    setHint('reg-password-hint', '', false);
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-password2').value = '';
    showScreen('screen-reg-password');
  }
}

// ============================================================
// REGISTRIERUNG — Schritt 3: Passwort festlegen
// ============================================================
async function onSetPassword() {
  const pw = document.getElementById('reg-password').value;
  const pw2 = document.getElementById('reg-password2').value;

  if (pw.length < 8) {
    setHint('reg-password-hint', 'Passwort muss mindestens 8 Zeichen haben.', true);
    return;
  }

  if (!/[a-z]/.test(pw)) {
    setHint('reg-password-hint', 'Passwort muss mindestens einen Kleinbuchstaben enthalten.', true);
    return;
  }

  if (!/[A-Z]/.test(pw)) {
    setHint('reg-password-hint', 'Passwort muss mindestens einen Großbuchstaben enthalten.', true);
    return;
  }

  if (pw !== pw2) {
    setHint('reg-password-hint', 'Passwörter stimmen nicht überein.', true);
    return;
  }

  setLoading('btn-set-password', true, 'Weiter');
  const { error } = await sb.auth.updateUser({ password: pw, data: { password_set: true } });
  setLoading('btn-set-password', false, 'Weiter');

  if (error) {
    setHint('reg-password-hint', 'Fehler: ' + error.message, true);
    return;
  }

  if (currentFlow === 'reset') {
    // Passwort-Reset abgeschlossen → direkt einloggen
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      afterLogin(session.user);
    } else {
      showScreen('screen-auth');
    }
    return;
  }

  setHint('register-hint', '3–15 Zeichen, Buchstaben, Zahlen, Bindestrich oder Unterstrich', false);
  document.getElementById('gamertag-input').value = '';
  showScreen('screen-register');
}

// ============================================================
// Gamertag in profiles-Tabelle speichern (unique constraint)
// Gibt { ok: true } oder { ok: false, message } zurück.
// ============================================================
async function saveGamertagToProfile(value) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok: false, message: 'Nicht eingeloggt.' };

  const { error } = await sb
    .from('profiles')
    .upsert({ user_id: session.user.id, gamertag: value }, { onConflict: 'user_id' });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Dieser Gamertag ist bereits vergeben.' };
    }
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

// ============================================================
// REGISTRIERUNG — Schritt 4: Gamertag festlegen
// ============================================================
async function onRegister() {
  const input = document.getElementById('gamertag-input');
  const hint = document.getElementById('register-hint');
  const value = input.value.trim();

  if (!/^[a-zA-ZäöüßÄÖÜ0-9\-_]{3,15}$/.test(value)) {
    hint.textContent = 'Ungültig. Nur Buchstaben (inkl. Umlaute), Zahlen, - oder _ erlaubt. 3–15 Zeichen.';
    hint.classList.add('error');
    input.focus();
    return;
  }

  setLoading('btn-register', true, 'Loslegen');

  const profileResult = await saveGamertagToProfile(value);
  if (!profileResult.ok) {
    setLoading('btn-register', false, 'Loslegen');
    hint.textContent = profileResult.message;
    hint.classList.add('error');
    return;
  }

  const { error } = await sb.auth.updateUser({ data: { gamertag: value } });
  setLoading('btn-register', false, 'Loslegen');

  if (error) {
    hint.textContent = 'Fehler beim Speichern: ' + error.message;
    hint.classList.add('error');
    return;
  }

  saveGamertag(value);
  showHome();
}

// ============================================================
// NACH LOGIN / SESSION-CHECK
// ============================================================
function afterLogin(user) {
  const gamertag = user.user_metadata?.gamertag;
  const passwordSet = user.user_metadata?.password_set;

  if (!passwordSet && !gamertag) {
    setHint('reg-password-hint', '', false);
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-password2').value = '';
    showScreen('screen-reg-password');
    return;
  }

  if (gamertag) {
    saveGamertag(gamertag);
    showHome();
  } else {
    setHint('register-hint', '3–15 Zeichen, Buchstaben, Zahlen, Bindestrich oder Unterstrich', false);
    document.getElementById('gamertag-input').value = '';
    showScreen('screen-register');
  }
}

// ============================================================
// HOME
// ============================================================
function showHome() {
  showSettingsBtn(true);
  document.getElementById('subtitle').textContent = 'Startseite';
  const gamertag = getGamertag();
  document.getElementById('greeting-name').textContent = gamertag;
  const avatarEl = document.getElementById('home-avatar');
  if (avatarEl && gamertag) avatarEl.textContent = gamertag.charAt(0);

  const streak = getActiveStreak();
  const streakPill = document.getElementById('streak-pill');
  if (streakPill) {
    if (streak >= 1) {
      document.getElementById('streak-pill-count').textContent = streak;
      streakPill.style.display = '';
    } else {
      streakPill.style.display = 'none';
    }
  }

  showScreen('screen-home');
  refreshFriendsHomeBadge();
  startAutoRefresh(refreshFriendsHomeBadge, 60000);
}

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

function hasPlayedToday() {
  return localStorage.getItem('quiz_lastPlayDate') === getTodayString();
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
  if (h > 0) return `noch ${h}h ${m}m`;
  if (m > 0) return `noch ${m}m ${s}s`;
  return `noch ${s}s`;
}

function showToast(msg, durationMs = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => { el.style.display = 'none'; }, durationMs);
}

function getTodayWkCount() {
  try {
    const data = JSON.parse(localStorage.getItem('quiz_wk_count') || '{}');
    return data.date === getTodayString() ? (data.count || 0) : 0;
  } catch { return 0; }
}

// ============================================================
// EINSTELLUNGEN
// ============================================================
function showSettings() {
  showSettingsBtn(true);
  document.getElementById('settings-gamertag-display').textContent = getGamertag();
  collapseGamertagForm();
  document.getElementById('subtitle').textContent = 'Einstellungen';
  showScreen('screen-settings');
  checkIsAdmin().then(isAdmin => {
    document.getElementById('settings-admin-section').style.display = isAdmin ? '' : 'none';
  });
}

function collapseGamertagForm() {
  document.getElementById('gamertag-edit-form').style.display = 'none';
  document.getElementById('btn-edit-gamertag').style.display = '';
  setHint('settings-gamertag-hint', '3–15 Zeichen, Buchstaben, Zahlen, - oder _', false);
  document.getElementById('settings-gamertag-input').value = '';
}

async function onSaveGamertag() {
  const input = document.getElementById('settings-gamertag-input');
  const value = input.value.trim();

  if (!/^[a-zA-ZäöüßÄÖÜ0-9\-_]{3,15}$/.test(value)) {
    setHint('settings-gamertag-hint', 'Ungültig. Nur Buchstaben (inkl. Umlaute), Zahlen, - oder _ erlaubt. 3–15 Zeichen.', true);
    input.focus();
    return;
  }

  setLoading('btn-save-gamertag', true, 'Speichern');

  const profileResult = await saveGamertagToProfile(value);
  if (!profileResult.ok) {
    setLoading('btn-save-gamertag', false, 'Speichern');
    setHint('settings-gamertag-hint', profileResult.message, true);
    return;
  }

  const { error } = await sb.auth.updateUser({ data: { gamertag: value } });
  setLoading('btn-save-gamertag', false, 'Speichern');

  if (error) {
    setHint('settings-gamertag-hint', 'Fehler: ' + error.message, true);
    return;
  }

  saveGamertag(value);
  document.getElementById('settings-gamertag-display').textContent = value;
  document.getElementById('greeting-name').textContent = value;
  const avatarEl = document.getElementById('home-avatar');
  if (avatarEl) avatarEl.textContent = value.charAt(0);
  collapseGamertagForm();
}

async function onDeleteAccount() {
  const confirmed = await new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title">Account löschen?</h3>
        <p class="modal-subtitle" style="color:#94a3b8;font-size:14px;margin-bottom:1rem">
          Dein Account und alle gespeicherten Daten (Statistiken, Freunde, Spielverlauf) werden
          <strong style="color:#e2e8f0">unwiderruflich gelöscht</strong>. Diese Aktion kann nicht rückgängig gemacht werden.
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" id="cancel-delete">Abbrechen</button>
          <button class="btn-logout" id="confirm-delete">Ja, Account löschen</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('confirm-delete').addEventListener('click', () => { modal.remove(); resolve(true); });
    document.getElementById('cancel-delete').addEventListener('click', () => { modal.remove(); resolve(false); });
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(false); } });
  });

  if (!confirmed) return;

  const btn = document.getElementById('btn-delete-account');
  btn.disabled = true;
  btn.textContent = '…';

  const { error } = await sb.rpc('delete_my_account');

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Account löschen';
    showToast('Fehler beim Löschen — bitte wende dich per E-Mail an uns.');
    return;
  }

  localStorage.clear();
  showSettingsBtn(false);
  document.getElementById('subtitle').textContent = '';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  setHint('login-hint', 'Dein Account wurde gelöscht.', false);
  showScreen('screen-auth');
}

async function onLogout() {
  await sb.auth.signOut();
  localStorage.removeItem('quiz_gamertag');
  showSettingsBtn(false);
  document.getElementById('subtitle').textContent = '';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  setHint('login-hint', '', false);
  showScreen('screen-auth');
}

// ============================================================
// ADMIN: GEMELDETE FRAGEN
// ============================================================
async function checkIsAdmin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return false;
  const { data } = await sb
    .from('profiles')
    .select('is_admin')
    .eq('user_id', session.user.id)
    .maybeSingle();
  return !!(data && data.is_admin);
}

async function showAdminReports() {
  document.getElementById('subtitle').textContent = 'Gemeldete Fragen';
  const container = document.getElementById('admin-reports-content');
  container.innerHTML = '<p class="loading-hint">Lade Meldungen…</p>';
  showScreen('screen-admin-reports');
  await loadAdminReports(container);
  startAutoRefresh(() => loadAdminReports(container), 30000);
}

const REPORT_REASON_LABELS = {
  grammar: '📝 Grammatik',
  wrong_answer: '❌ Falsche Antwort',
  unclear: '❓ Unklar',
  other: '… Sonstiges',
};

async function loadAdminReports(container) {
  try {
    const { data, error } = await sb
      .from('question_reports')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="loading-hint">🎉 Keine offenen Meldungen.</p>';
      return;
    }

    // Gruppieren nach question_hash + reason
    const groups = {};
    data.forEach(r => {
      const key = `${r.question_hash}__${r.reason}`;
      if (!groups[key]) groups[key] = { ...r, count: 0, comments: [], ids: [] };
      groups[key].count++;
      groups[key].ids.push(r.id);
      if (r.comment) groups[key].comments.push(r.comment);
    });

    const sorted = Object.values(groups).sort((a, b) => b.count - a.count);

    let html = `<p class="admin-reports-summary">${data.length} offene Meldung${data.length !== 1 ? 'en' : ''} (${sorted.length} verschieden)</p>`;
    html += `<div class="admin-reports-list">`;
    sorted.forEach(g => {
      const commentsHtml = g.comments.length > 0
        ? `<div class="admin-report-comments">${g.comments.map(c => `<p>„${escapeHtml(c)}"</p>`).join('')}</div>`
        : '';
      html += `
        <div class="admin-report-card">
          <div class="admin-report-header">
            <span class="admin-report-reason">${REPORT_REASON_LABELS[g.reason] || g.reason}</span>
            <span class="admin-report-count">${g.count}× gemeldet</span>
          </div>
          <p class="admin-report-question">${escapeHtml(g.question_text)}</p>
          <p class="admin-report-meta">Thema: ${escapeHtml(g.topic_id)}</p>
          ${commentsHtml}
          <div class="admin-report-actions">
            <button class="btn-secondary" data-ids="${escapeHtml(JSON.stringify(g.ids))}" data-hash="${escapeHtml(g.question_hash)}" data-action="edit" style="font-size:13px;padding:6px 10px">✏️ Bearbeiten</button>
            <button class="btn-logout" data-ids="${escapeHtml(JSON.stringify(g.ids))}" data-hash="${escapeHtml(g.question_hash)}" data-action="hide" style="font-size:13px;padding:6px 10px">🚫 Verstecken</button>
            <button class="btn-friend-accept" data-ids="${escapeHtml(JSON.stringify(g.ids))}" data-action="resolved">✓ Erledigt</button>
            <button class="btn-friend-reject" data-ids="${escapeHtml(JSON.stringify(g.ids))}" data-action="dismissed">✗ Verwerfen</button>
          </div>
        </div>
      `;
    });
    html += `</div>`;

    container.innerHTML = html;
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        let ids;
        try { ids = JSON.parse(btn.dataset.ids); } catch { return; }

        if (action === 'edit') {
          const hash = btn.dataset.hash;
          const group = sorted.find(g => g.question_hash === hash);
          if (group) openAdminEditModal(group, container);
          return;
        }

        if (action === 'hide') {
          const hash = btn.dataset.hash;
          btn.disabled = true;
          btn.textContent = '…';
          const ok = await adminHideQuestion(hash, ids);
          if (ok) { showToast('Frage versteckt ✓'); loadAdminReports(container); }
          else btn.disabled = false;
          return;
        }

        const { error: uerr } = await sb
          .from('question_reports')
          .update({ status: action })
          .in('id', ids);
        if (uerr) { showToast('Fehler beim Speichern — bitte nochmal versuchen.'); return; }
        loadAdminReports(container);
      });
    });
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// ADMIN: FRAGE VERSTECKEN
// ============================================================
function adminQuestionHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString();
}

function clearOverrideCache() {
  localStorage.removeItem('quiz_overrides_v1');
}

async function adminHideQuestion(questionHash, reportIds) {
  const { error } = await sb.from('question_overrides').upsert({
    question_hash: questionHash,
    action: 'hidden',
    new_question: null,
    new_answers: null,
    new_correct_index: null,
  }, { onConflict: 'question_hash' });
  if (error) { showToast('Fehler: ' + error.message); return false; }
  await sb.from('question_reports').update({ status: 'resolved' }).in('id', reportIds);
  clearOverrideCache();
  return true;
}

// ============================================================
// ADMIN: FRAGE BEARBEITEN (MODAL)
// ============================================================
let _adminEditingGroup = null;
let _adminEditContainer = null;

function openAdminEditModal(group, container) {
  _adminEditingGroup = group;
  _adminEditContainer = container;

  const hintEl = document.getElementById('admin-edit-hint');
  hintEl.textContent = '';
  hintEl.classList.remove('error');

  let foundQ = null;
  if (typeof QUESTIONS !== 'undefined') {
    outer: for (const qs of Object.values(QUESTIONS)) {
      for (const q of qs) {
        if (adminQuestionHash(q.question) === group.question_hash) {
          foundQ = q;
          break outer;
        }
      }
    }
  }

  document.getElementById('admin-edit-question-text').value =
    foundQ ? foundQ.question : group.question_text;

  const answers = foundQ ? foundQ.answers : ['', '', '', ''];
  const correctIndex = foundQ ? foundQ.correctIndex : 0;

  document.getElementById('admin-edit-answers-container').innerHTML = answers.map((a, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin:6px 0">
      <input type="radio" name="admin-correct" id="admin-correct-${i}" value="${i}" ${i === correctIndex ? 'checked' : ''} />
      <label for="admin-correct-${i}" style="font-size:13px;color:#94a3b8;min-width:16px;cursor:pointer">${String.fromCharCode(65 + i)}</label>
      <input type="text" class="text-input" id="admin-answer-${i}" value="${escapeHtml(a)}" placeholder="Antwort ${String.fromCharCode(65 + i)}" style="margin:0;flex:1;font-size:14px" />
    </div>
  `).join('');

  document.getElementById('admin-edit-modal').style.display = 'flex';
}

async function saveAdminEdit() {
  if (!_adminEditingGroup) return;

  const hintEl = document.getElementById('admin-edit-hint');
  hintEl.textContent = '';
  hintEl.classList.remove('error');

  const newQuestion = document.getElementById('admin-edit-question-text').value.trim();
  if (!newQuestion) {
    hintEl.textContent = 'Frage darf nicht leer sein.';
    hintEl.classList.add('error');
    return;
  }

  const newAnswers = [0, 1, 2, 3].map(i => {
    const el = document.getElementById(`admin-answer-${i}`);
    return el ? el.value.trim() : '';
  });
  if (newAnswers.some(a => !a)) {
    hintEl.textContent = 'Alle 4 Antworten müssen ausgefüllt sein.';
    hintEl.classList.add('error');
    return;
  }

  const correctRadio = document.querySelector('input[name="admin-correct"]:checked');
  const newCorrectIndex = correctRadio ? parseInt(correctRadio.value) : 0;

  const saveBtn = document.getElementById('btn-admin-edit-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '…';

  const { error } = await sb.from('question_overrides').upsert({
    question_hash: _adminEditingGroup.question_hash,
    action: 'edited',
    new_question: newQuestion,
    new_answers: newAnswers,
    new_correct_index: newCorrectIndex,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'question_hash' });

  saveBtn.disabled = false;
  saveBtn.textContent = 'Speichern ✓';

  if (error) {
    hintEl.textContent = 'Fehler: ' + error.message;
    hintEl.classList.add('error');
    return;
  }

  await sb.from('question_reports').update({ status: 'resolved' }).in('id', _adminEditingGroup.ids);
  clearOverrideCache();
  document.getElementById('admin-edit-modal').style.display = 'none';
  const container = _adminEditContainer;
  _adminEditingGroup = null;
  _adminEditContainer = null;
  showToast('Frage gespeichert ✓');
  loadAdminReports(container);
}

function closeAdminEditModal() {
  document.getElementById('admin-edit-modal').style.display = 'none';
  _adminEditingGroup = null;
  _adminEditContainer = null;
}

// ============================================================
// ADMIN: RANGLISTE VERWALTEN
// ============================================================
async function showAdminRangliste() {
  document.getElementById('subtitle').textContent = 'Rangliste verwalten';
  const container = document.getElementById('admin-rangliste-content');
  container.innerHTML = '<p class="loading-hint">Lade…</p>';
  showScreen('screen-admin-rangliste');
  await loadAdminRangliste(container);
}

async function loadAdminRangliste(container) {
  try {
    const { count, error } = await sb
      .from('wettkampf_history')
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(error.message);

    container.innerHTML = `
      <div class="settings-card" style="margin:1rem">
        <h2 class="settings-title">Rangliste verwalten</h2>

        <div class="settings-section">
          <div class="settings-label">Gesamt: ${count ?? '?'} Einträge</div>
        </div>

        <div class="settings-section">
          <div class="settings-label">Gamertag suchen & löschen</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input type="text" id="admin-gamertag-search" class="text-input"
              placeholder="Gamertag eingeben" style="margin:0;flex:1" />
            <button class="btn-edit-tag" id="btn-admin-gamertag-search">Suchen</button>
          </div>
          <div id="admin-gamertag-result" style="margin-top:8px"></div>
        </div>

        <div class="settings-section">
          <div class="settings-label">Alle Einträge zurücksetzen</div>
          <p style="font-size:13px;color:#94a3b8;margin:4px 0 10px">
            Löscht alle Wettkampf-Einträge aller User. Nicht rückgängig!
          </p>
          <button class="btn-logout" id="btn-admin-reset-all">🗑️ Alle Einträge löschen</button>
        </div>
      </div>
    `;

    document.getElementById('btn-admin-gamertag-search').addEventListener('click', adminSearchGamertag);
    document.getElementById('admin-gamertag-search').addEventListener('keydown', e => {
      if (e.key === 'Enter') adminSearchGamertag();
    });
    document.getElementById('btn-admin-reset-all').addEventListener('click', adminResetAll);
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

async function adminSearchGamertag() {
  const gamertag = document.getElementById('admin-gamertag-search').value.trim();
  const result = document.getElementById('admin-gamertag-result');
  if (!gamertag) return;

  result.innerHTML = '<p class="loading-hint" style="margin:0">Suche…</p>';

  const { data, error } = await sb
    .from('wettkampf_history')
    .select('id, played_date, score')
    .ilike('gamertag', gamertag)
    .order('played_date', { ascending: false });

  if (error) {
    result.innerHTML = `<p style="color:#f87171;font-size:13px">Fehler: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    result.innerHTML = `<p style="font-size:13px;color:#94a3b8">Keine Einträge für „${escapeHtml(gamertag)}" gefunden.</p>`;
    return;
  }

  const ids = data.map(r => r.id);
  result.innerHTML = `
    <p style="font-size:13px;color:#94a3b8;margin:0 0 8px">${data.length} Einträge gefunden.</p>
    <button class="btn-logout" id="btn-admin-delete-gamertag" style="font-size:13px;padding:8px 14px">
      🗑️ ${data.length} Einträge löschen
    </button>
  `;
  document.getElementById('btn-admin-delete-gamertag').addEventListener('click', async () => {
    const { error: delErr } = await sb.from('wettkampf_history').delete().in('id', ids);
    if (delErr) { showToast('Fehler beim Löschen.'); return; }
    showToast(`${ids.length} Einträge gelöscht ✓`);
    const container = document.getElementById('admin-rangliste-content');
    loadAdminRangliste(container);
  });
}

async function adminResetAll() {
  const confirmed = await new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title">⚠️ Alle Einträge löschen?</h3>
        <p class="modal-subtitle">Löscht die komplette Wettkampf-Geschichte aller User. Nicht rückgängig zu machen!</p>
        <div class="modal-actions">
          <button class="btn-secondary" id="cancel-reset">Abbrechen</button>
          <button class="btn-logout" id="confirm-reset">Ja, alles löschen</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('confirm-reset').addEventListener('click', () => { modal.remove(); resolve(true); });
    document.getElementById('cancel-reset').addEventListener('click', () => { modal.remove(); resolve(false); });
  });

  if (!confirmed) return;

  const { error } = await sb.from('wettkampf_history').delete().gte('played_date', '2000-01-01');
  if (error) { showToast('Fehler: ' + error.message); return; }
  showToast('Alle Einträge gelöscht ✓');
  const container = document.getElementById('admin-rangliste-content');
  loadAdminRangliste(container);
}

// ============================================================
// QUIZBATTLE – EINLADUNGS-BANNER & CHALLENGE
// ============================================================
// ============================================================
// FREUNDE
// ============================================================
let currentFriendStats = null; // { userId, gamertag } für Freund-Stats-Screen

async function loadFriendsData() {
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData?.session;
  if (!session) return null;
  const me = session.user.id;

  const { data: links, error } = await sb
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  if (error) throw new Error(error.message);

  const otherIds = (links || []).map(l => l.requester_id === me ? l.addressee_id : l.requester_id);
  let profileMap = {};
  if (otherIds.length > 0) {
    const { data: profiles } = await sb
      .from('profiles')
      .select('user_id, gamertag')
      .in('user_id', otherIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p.gamertag; });
  }

  const accepted = [], incoming = [], outgoing = [];
  (links || []).forEach(l => {
    const otherId = l.requester_id === me ? l.addressee_id : l.requester_id;
    const entry = { id: l.id, userId: otherId, gamertag: profileMap[otherId] || '?' };
    if (l.status === 'accepted') accepted.push(entry);
    else if (l.requester_id === me) outgoing.push(entry);
    else incoming.push(entry);
  });

  accepted.sort((a, b) => a.gamertag.localeCompare(b.gamertag));
  return { me, accepted, incoming, outgoing };
}

async function refreshFriendsHomeBadge() {
  try {
    const data = await loadFriendsData();
    const badge = document.getElementById('friends-home-badge');
    if (!badge || !data) return;
    if (data.incoming.length > 0) {
      badge.textContent = data.incoming.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

function showBattleMenu() {
  document.getElementById('subtitle').textContent = 'Battle';
  showScreen('screen-battle-menu');
}

async function showBattleFriends() {
  document.getElementById('subtitle').textContent = 'Freund auswählen';
  const container = document.getElementById('battle-friends-content');
  container.innerHTML = '<p class="loading-hint">Lade Freunde…</p>';
  showScreen('screen-battle-friends');
  try {
    const data = await loadFriendsData();
    if (!data) { container.innerHTML = '<p class="loading-hint">Nicht eingeloggt.</p>'; return; }
    if (data.accepted.length === 0) {
      container.innerHTML = '<p class="loading-hint">Noch keine Freunde — füge zuerst Freunde hinzu!</p>';
      return;
    }
    let html = `<h3 class="friends-section-title">🧑‍🤝‍🧑 Freund auswählen</h3><div class="friends-list">`;
    data.accepted.forEach(f => {
      html += `
        <div class="friend-row">
          <span class="friend-name">${escapeHtml(f.gamertag)}</span>
          <button class="btn-battle-challenge" data-uid="${f.userId}">Auswählen ›</button>
        </div>
      `;
    });
    html += `</div>`;
    container.innerHTML = html;
    container.querySelectorAll('.btn-battle-challenge').forEach(b => {
      b.addEventListener('click', () => {
        window.location.href = `battle/index.html?friendId=${b.dataset.uid}`;
      });
    });
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

async function showFriends() {
  document.getElementById('subtitle').textContent = 'Freunde';
  const container = document.getElementById('friends-content');
  container.innerHTML = '<p class="loading-hint">Lade Freunde…</p>';
  showScreen('screen-friends');
  await renderFriends(container);
  startAutoRefresh(() => renderFriends(container), 30000);
}

async function renderFriends(container) {
  try {
    const data = await loadFriendsData();
    if (!data) {
      container.innerHTML = '<p class="loading-hint">Nicht eingeloggt.</p>';
      return;
    }

    let html = `
      <div class="friends-add-card">
        <h3 class="friends-section-title">➕ Freund hinzufügen</h3>
        <div class="friends-add-form">
          <input type="text" id="friend-search-input" class="text-input"
            placeholder="Gamertag eingeben" maxlength="15"
            autocomplete="off" autocapitalize="off" spellcheck="false" />
          <button class="btn-primary" id="btn-friend-send">Anfrage senden</button>
        </div>
        <p class="auth-hint" id="friend-search-hint"></p>
      </div>
    `;

    if (data.incoming.length > 0) {
      html += `<h3 class="friends-section-title">📨 Eingehende Anfragen</h3><div class="friends-list">`;
      data.incoming.forEach(f => {
        html += `
          <div class="friend-row" data-id="${f.id}">
            <span class="friend-name">${escapeHtml(f.gamertag)}</span>
            <div class="friend-actions">
              <button class="btn-friend-accept" data-id="${f.id}">✓ Annehmen</button>
              <button class="btn-friend-reject" data-id="${f.id}">✗ Ablehnen</button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    html += `<h3 class="friends-section-title">🧑‍🤝‍🧑 Meine Freunde</h3>`;
    if (data.accepted.length === 0) {
      html += `<p class="loading-hint">Noch keine Freunde — schick eine Anfrage!</p>`;
    } else {
      html += `<div class="friends-list">`;
      data.accepted.forEach(f => {
        html += `
          <div class="friend-row" data-id="${f.id}">
            <button class="friend-name-btn" data-uid="${f.userId}" data-tag="${escapeHtml(f.gamertag)}">
              <span class="friend-name">${escapeHtml(f.gamertag)}</span>
              <span class="topic-arrow">›</span>
            </button>
            <button class="btn-friend-remove" data-id="${f.id}" title="Entfernen">✕</button>
          </div>
        `;
      });
      html += `</div>`;
    }

    if (data.outgoing.length > 0) {
      html += `<h3 class="friends-section-title">⏳ Gesendete Anfragen</h3><div class="friends-list">`;
      data.outgoing.forEach(f => {
        html += `
          <div class="friend-row" data-id="${f.id}">
            <span class="friend-name friend-name-muted">${escapeHtml(f.gamertag)}</span>
            <button class="btn-friend-cancel" data-id="${f.id}">Abbrechen</button>
          </div>
        `;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    wireFriendsActions(container);
    refreshFriendsHomeBadge();
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function wireFriendsActions(container) {
  const searchInput = container.querySelector('#friend-search-input');
  const sendBtn = container.querySelector('#btn-friend-send');
  const hint = container.querySelector('#friend-search-hint');

  const send = () => onSendFriendRequest(searchInput.value.trim(), hint, container);
  sendBtn?.addEventListener('click', send);
  searchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  container.querySelectorAll('.btn-friend-accept').forEach(b =>
    b.addEventListener('click', () => onAcceptFriend(b.dataset.id, container)));
  container.querySelectorAll('.btn-friend-reject').forEach(b =>
    b.addEventListener('click', () => onDeleteFriendship(b.dataset.id, container, 'Anfrage abgelehnt.')));
  container.querySelectorAll('.btn-friend-cancel').forEach(b =>
    b.addEventListener('click', () => onDeleteFriendship(b.dataset.id, container, 'Anfrage abgebrochen.')));
  container.querySelectorAll('.btn-friend-remove').forEach(b =>
    b.addEventListener('click', () => {
      if (confirm('Freund wirklich entfernen?')) {
        onDeleteFriendship(b.dataset.id, container, 'Freund entfernt.');
      }
    }));
  container.querySelectorAll('.friend-name-btn').forEach(b =>
    b.addEventListener('click', () => showFriendStats(b.dataset.uid, b.dataset.tag)));
}

async function onSendFriendRequest(gamertag, hintEl, container) {
  if (!gamertag) {
    hintEl.textContent = 'Gamertag eingeben.';
    hintEl.classList.add('error');
    return;
  }
  const myTag = getGamertag();
  if (gamertag.toLowerCase() === (myTag || '').toLowerCase()) {
    hintEl.textContent = 'Das bist du selbst.';
    hintEl.classList.add('error');
    return;
  }

  hintEl.textContent = 'Suche…';
  hintEl.classList.remove('error');

  const { data: profile, error: pErr } = await sb
    .from('profiles')
    .select('user_id, gamertag')
    .ilike('gamertag', gamertag)
    .maybeSingle();

  if (pErr || !profile) {
    hintEl.textContent = 'Kein Spieler mit diesem Gamertag gefunden.';
    hintEl.classList.add('error');
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  const { error: insErr } = await sb.from('friendships').insert({
    requester_id: session.user.id,
    addressee_id: profile.user_id,
    status: 'pending',
  });

  if (insErr) {
    if (insErr.code === '23505') {
      hintEl.textContent = 'Anfrage existiert bereits oder ihr seid schon Freunde.';
    } else if (insErr.code === '23514') {
      hintEl.textContent = 'Du kannst dich nicht selbst hinzufügen.';
    } else {
      hintEl.textContent = 'Fehler: ' + insErr.message;
    }
    hintEl.classList.add('error');
    return;
  }

  hintEl.textContent = `Anfrage an ${profile.gamertag} gesendet.`;
  hintEl.classList.remove('error');
  await renderFriends(container);
}

async function onAcceptFriend(id, container) {
  const { error } = await sb
    .from('friendships')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { showToast('Fehler — bitte nochmal versuchen.'); return; }
  await renderFriends(container);
}

async function onDeleteFriendship(id, container, _msg) {
  const { error } = await sb.from('friendships').delete().eq('id', id);
  if (error) { showToast('Fehler — bitte nochmal versuchen.'); return; }
  await renderFriends(container);
}

// ============================================================
// FREUND-STATISTIKEN (gleiche Stats wie eigene, ohne Wettkampf-Verlauf)
// ============================================================
async function showFriendStats(friendUserId, friendGamertag) {
  currentFriendStats = { userId: friendUserId, gamertag: friendGamertag };
  document.getElementById('subtitle').textContent = `Stats von ${friendGamertag}`;
  const container = document.getElementById('friend-stats-content');
  container.innerHTML = '<p class="loading-hint">Lade Statistiken…</p>';
  showScreen('screen-friend-stats');
  await loadFriendStats(container, friendUserId, friendGamertag);
  startAutoRefresh(() => loadFriendStats(container, friendUserId, friendGamertag), 30000);
}

async function loadFriendStats(container, friendUserId, friendGamertag) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const myId = session?.user?.id;

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), 6000));
    const [statsResp, wrongResp, battlesAsHost, battlesAsGuest] = await Promise.race([
      Promise.all([
        sb.from('topic_stats').select('*').eq('user_id', friendUserId),
        sb.from('wrong_questions').select('topic_id').eq('user_id', friendUserId),
        sb.from('battles').select('host_score,guest_score,topic_id,difficulty,finished_at')
          .eq('status', 'finished').eq('host_id', myId).eq('guest_id', friendUserId)
          .order('finished_at', { ascending: false }),
        sb.from('battles').select('host_score,guest_score,topic_id,difficulty,finished_at')
          .eq('status', 'finished').eq('host_id', friendUserId).eq('guest_id', myId)
          .order('finished_at', { ascending: false }),
      ]),
      timeout,
    ]);
    if (statsResp.error) throw new Error(statsResp.error.message);
    if (wrongResp.error) throw new Error(wrongResp.error.message);

    // Battle-Statistik berechnen
    const allBattles = [
      ...(battlesAsHost.data || []).map(b => ({ myScore: b.host_score, oppScore: b.guest_score, topic: b.topic_id, diff: b.difficulty, date: b.finished_at })),
      ...(battlesAsGuest.data || []).map(b => ({ myScore: b.guest_score, oppScore: b.host_score, topic: b.topic_id, diff: b.difficulty, date: b.finished_at })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const wins   = allBattles.filter(b => b.myScore > b.oppScore).length;
    const losses = allBattles.filter(b => b.myScore < b.oppScore).length;
    const draws  = allBattles.filter(b => b.myScore === b.oppScore).length;
    const totalPtsMe  = allBattles.reduce((s, b) => s + b.myScore, 0);
    const totalPtsOpp = allBattles.reduce((s, b) => s + b.oppScore, 0);

    const statsData = statsResp.data || [];
    const wrongData = wrongResp.data || [];

    const statsMap = {};
    statsData.forEach(r => { statsMap[r.topic_id] = r; });
    const wrongMap = {};
    wrongData.forEach(r => { wrongMap[r.topic_id] = (wrongMap[r.topic_id] || 0) + 1; });

    const totalAnswered = statsData.reduce((s, r) => s + r.total_answered, 0);
    const totalCorrect  = statsData.reduce((s, r) => s + r.correct_answered, 0);
    const overallPct    = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;

    let html = `<h2 class="friend-stats-heading">📊 ${escapeHtml(friendGamertag)}</h2>`;

    // ---- Battle-Statistik Abschnitt ----
    html += `<div class="battle-history-section">`;
    html += `<h3 class="stats-section-title" style="margin-bottom:0.75rem">⚔️ Quizbattle gegen ${escapeHtml(friendGamertag)}</h3>`;

    if (allBattles.length === 0) {
      html += `<p class="loading-hint" style="margin:0 0 1rem">Noch keine Battles gespielt.</p>`;
    } else {
      const myTag  = getGamertag() || 'Du';
      html += `
        <div class="bh-scoreboard">
          <div class="bh-scoreboard-player">
            <div class="bh-scoreboard-name">${escapeHtml(myTag)}</div>
            <div class="bh-scoreboard-big ${wins > losses ? 'bh-winning' : ''}">${wins}</div>
            <div class="bh-scoreboard-label">Siege</div>
          </div>
          <div class="bh-scoreboard-mid">
            <div class="bh-scoreboard-draws">${draws}</div>
            <div class="bh-scoreboard-draws-label">Unentschieden</div>
            <div class="bh-scoreboard-total">${allBattles.length} Battles</div>
          </div>
          <div class="bh-scoreboard-player">
            <div class="bh-scoreboard-name">${escapeHtml(friendGamertag)}</div>
            <div class="bh-scoreboard-big ${losses > wins ? 'bh-winning' : ''}">${losses}</div>
            <div class="bh-scoreboard-label">Siege</div>
          </div>
        </div>
        <div class="bh-pts-row">
          <span class="bh-pts">${totalPtsMe} Pkt.</span>
          <span class="bh-pts-label">Gesamtpunkte</span>
          <span class="bh-pts">${totalPtsOpp} Pkt.</span>
        </div>
      `;

      // Letzte Battles (max 5)
      html += `<div class="bh-list">`;
      allBattles.slice(0, 5).forEach(b => {
        const won  = b.myScore > b.oppScore;
        const draw = b.myScore === b.oppScore;
        const resultClass = won ? 'bh-win' : draw ? 'bh-draw' : 'bh-loss';
        const resultLabel = won ? 'Sieg' : draw ? 'Unentschieden' : 'Niederlage';
        const topicObj = TOPICS.find(t => t.id === b.topic);
        const topicStr = topicObj ? `${topicObj.icon} ${topicObj.name}` : b.topic === 'mix' ? '🎲 Mix' : b.topic;
        const diffStr  = b.diff === 'leicht' ? '😊' : b.diff === 'mittel' ? '⚡' : b.diff === 'schwer' ? '🔥' : '🎲';
        const dateStr  = b.date ? new Date(b.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
        html += `
          <div class="bh-row">
            <span class="bh-badge ${resultClass}">${resultLabel}</span>
            <span class="bh-score">${b.myScore} : ${b.oppScore}</span>
            <span class="bh-meta">${diffStr} ${topicStr}</span>
            <span class="bh-date">${dateStr}</span>
          </div>
        `;
      });
      html += `</div>`;
    }
    html += `</div>`;
    // ---- Ende Battle-Statistik ----

    if (totalAnswered === 0) {
      html += '<p class="loading-hint">Noch keine Daten.</p>';
    } else {
      html += `
        <div class="stats-overall">
          <div class="stats-overall-item">
            <div class="stats-overall-value">${totalAnswered}</div>
            <div class="stats-overall-label">Fragen beantwortet</div>
          </div>
          <div class="stats-overall-item">
            <div class="stats-overall-value">${overallPct}%</div>
            <div class="stats-overall-label">Gesamtquote</div>
          </div>
        </div>
        <div class="stats-topics">
      `;
      const renderFriendTopicCard = (topic, s) => {
        const pct = Math.round((s.correct_answered / s.total_answered) * 100);
        return `
          <div class="stats-topic-card" style="--card-color: ${topic.color}">
            <div class="stats-topic-header">
              <span class="stats-topic-icon">${topic.icon}</span>
              <span class="stats-topic-name">${topic.name}</span>
              <span class="stats-topic-pct">${pct}%</span>
            </div>
            <div class="stats-bar-track">
              <div class="stats-bar-fill" style="width: ${pct}%; background: ${topic.color}"></div>
            </div>
            <div class="stats-topic-footer">
              <span>${s.total_answered} beantwortet</span>
            </div>
          </div>
        `;
      };

      TOPICS.forEach(topic => {
        const s = statsMap[topic.id];
        if (!s || s.total_answered === 0) return;
        html += renderFriendTopicCard(topic, s);
      });

      const geoWithData = GEO_TOPIC_DEFS.filter(t => statsMap[t.id] && statsMap[t.id].total_answered > 0);
      if (geoWithData.length > 0) {
        html += `<div class="stats-section-title" style="margin-top:1.25rem;margin-bottom:0.5rem">🌍 Geographie</div>`;
        geoWithData.forEach(topic => html += renderFriendTopicCard(topic, statsMap[topic.id]));
      }

      html += '</div>';
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// STATISTIKEN
// ============================================================
async function showStats() {
  document.getElementById('subtitle').textContent = 'Statistiken';
  const container = document.getElementById('stats-content');
  container.innerHTML = '<p class="loading-hint">Lade Statistiken…</p>';
  showScreen('screen-stats');
  await loadStats(container);
  startAutoRefresh(() => loadStats(container), 30000);
}

async function loadStats(container) {
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData?.session;
    if (!session) {
      container.innerHTML = '<p class="loading-hint">Nicht eingeloggt.</p>';
      return;
    }
    const userId = session.user.id;

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), 6000));
    const [statsResp, wrongResp] = await Promise.race([
      Promise.all([
        sb.from('topic_stats').select('*').eq('user_id', userId),
        sb.from('wrong_questions').select('topic_id').eq('user_id', userId),
      ]),
      timeout,
    ]);

    if (statsResp.error) throw new Error(statsResp.error.message);
    if (wrongResp.error) throw new Error(wrongResp.error.message);

    const statsData = statsResp.data || [];
    const wrongData = wrongResp.data || [];

    const statsMap = {};
    statsData.forEach(r => { statsMap[r.topic_id] = r; });

    const wrongMap = {};
    wrongData.forEach(r => { wrongMap[r.topic_id] = (wrongMap[r.topic_id] || 0) + 1; });

    const totalAnswered = statsData.reduce((s, r) => s + r.total_answered, 0);
    const totalCorrect  = statsData.reduce((s, r) => s + r.correct_answered, 0);
    const overallPct    = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;

    let html = '';

    if (totalAnswered === 0) {
      html = '<p class="loading-hint">Noch keine Daten – spiel eine Runde Üben!</p>';
    } else {
      html += `
        <div class="stats-overall">
          <div class="stats-overall-item">
            <div class="stats-overall-value">${totalAnswered}</div>
            <div class="stats-overall-label">Fragen beantwortet</div>
          </div>
          <div class="stats-overall-item">
            <div class="stats-overall-value">${overallPct}%</div>
            <div class="stats-overall-label">Gesamtquote</div>
          </div>
        </div>
        <div class="stats-topics">
      `;
      const renderTopicCard = (topic, s, wrong) => `
          <div class="stats-topic-card" style="--card-color: ${topic.color}">
            <div class="stats-topic-header">
              <span class="stats-topic-icon">${topic.icon}</span>
              <span class="stats-topic-name">${topic.name}</span>
              <span class="stats-topic-pct">${Math.round((s.correct_answered / s.total_answered) * 100)}%</span>
            </div>
            <div class="stats-bar-track">
              <div class="stats-bar-fill" style="width: ${Math.round((s.correct_answered / s.total_answered) * 100)}%; background: ${topic.color}"></div>
            </div>
            <div class="stats-topic-footer">
              <span>${s.total_answered} beantwortet</span>
              ${wrong > 0 ? `<span class="stats-wrong-hint">${wrong} offen</span>` : '<span class="stats-all-ok">✓ alles richtig</span>'}
            </div>
          </div>
        `;

      TOPICS.forEach(topic => {
        const s = statsMap[topic.id];
        if (!s || s.total_answered === 0) return;
        html += renderTopicCard(topic, s, wrongMap[topic.id] || 0);
      });

      const geoWithData = GEO_TOPIC_DEFS.filter(t => statsMap[t.id] && statsMap[t.id].total_answered > 0);
      if (geoWithData.length > 0) {
        html += `<div class="stats-section-title" style="margin-top:1.25rem;margin-bottom:0.5rem">🌍 Geographie</div>`;
        geoWithData.forEach(topic => {
          html += renderTopicCard(topic, statsMap[topic.id], wrongMap[topic.id] || 0);
        });
      }

      html += '</div>';
    }

    html += `
      <button class="btn-history-link" id="btn-show-history">
        🏆 Wettkampf Statistiken
      </button>
    `;

    container.innerHTML = html;
    document.getElementById('btn-show-history').addEventListener('click', showHistory);
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${e.message}</p>`;
  }
}

async function showHistory() {
  document.getElementById('subtitle').textContent = 'Wettkampf Statistiken';
  const container = document.getElementById('history-content');
  container.innerHTML = '<p class="loading-hint">Lade…</p>';
  showScreen('screen-history');
  await loadHistory(container);
  startAutoRefresh(() => loadHistory(container), 30000);
}

async function loadHistory(container) {
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData?.session;
    if (!session) { container.innerHTML = '<p class="loading-hint">Nicht eingeloggt.</p>'; return; }

    const { data, error } = await sb
      .from('wettkampf_history')
      .select('*')
      .eq('user_id', session.user.id)
      .order('played_date', { ascending: false })
      .limit(30);

    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="loading-hint">Noch kein Wettkampf gespielt.</p>';
      return;
    }

    const bestEntry = data.reduce((best, e) => e.score > best.score ? e : best, data[0]);
    const bestColor = bestEntry.score >= 10 ? '#10b981' : bestEntry.score >= 5 ? '#f59e0b' : '#ef4444';

    let html = `
      <div class="stats-record-card">
        <div class="stats-record-label">Persönlicher Rekord</div>
        <div class="stats-record-value" style="color: ${bestColor}">
          ${bestEntry.score > 0 ? '+' : ''}${bestEntry.score} Punkte
        </div>
        <div class="stats-record-detail">${bestEntry.correct}/15 richtig</div>
      </div>
      <h3 class="stats-section-title">Verlauf</h3>
      <div class="stats-history">
    `;

    data.forEach(entry => {
      const date = new Date(entry.played_date + 'T12:00:00');
      const dayStr = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
      const scoreColor = entry.score >= 10 ? '#10b981' : entry.score >= 5 ? '#f59e0b' : '#ef4444';
      const pct = Math.round((entry.correct / 15) * 100);
      const isRecord = entry.score === bestEntry.score && entry.played_date === bestEntry.played_date;
      html += `
        <div class="stats-history-row${isRecord ? ' stats-history-record' : ''}">
          <span class="stats-history-date">${dayStr}</span>
          <div class="stats-bar-track stats-history-bar">
            <div class="stats-bar-fill" style="width: ${pct}%; background: ${scoreColor}"></div>
          </div>
          <span class="stats-history-detail">${entry.correct}/15</span>
          <span class="stats-history-score" style="color: ${scoreColor}">${entry.score > 0 ? '+' : ''}${entry.score}</span>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="loading-hint">Fehler: ${e.message}</p>`;
  }
}

// ============================================================
// INIT
// ============================================================
function updateOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.style.display = navigator.onLine ? 'none' : '';
}

document.addEventListener('DOMContentLoaded', async () => {
  updateOfflineBanner();
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);

  // Login
  document.getElementById('btn-login').addEventListener('click', onLogin);
  document.getElementById('login-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') onLogin();
  });
  document.getElementById('btn-go-register').addEventListener('click', () => {
    currentFlow = 'register';
    document.getElementById('reg-email-emoji').textContent = '✉️';
    document.getElementById('reg-email-title').textContent = 'Registrieren';
    document.getElementById('reg-email-subtitle').textContent =
      'Gib deine E-Mail ein. Wir schicken dir einen 8-stelligen Code.';
    document.getElementById('reg-password-title').textContent = 'Passwort festlegen';
    setHint('reg-email-hint', '', false);
    document.getElementById('reg-email').value = '';
    showScreen('screen-reg-email');
  });

  document.getElementById('btn-forgot-password').addEventListener('click', () => {
    currentFlow = 'reset';
    document.getElementById('reg-email-emoji').textContent = '🔑';
    document.getElementById('reg-email-title').textContent = 'Passwort zurücksetzen';
    document.getElementById('reg-email-subtitle').textContent =
      'Gib deine E-Mail ein. Wir schicken dir einen 8-stelligen Code zum Zurücksetzen.';
    document.getElementById('reg-password-title').textContent = 'Neues Passwort festlegen';
    setHint('reg-email-hint', '', false);
    document.getElementById('reg-email').value =
      document.getElementById('login-email').value || '';
    showScreen('screen-reg-email');
  });

  // Registrierung Schritt 1
  document.getElementById('btn-send-code').addEventListener('click', onSendCode);
  document.getElementById('reg-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSendCode();
  });
  document.getElementById('btn-go-login').addEventListener('click', () => showScreen('screen-auth'));

  // Registrierung Schritt 2
  document.getElementById('btn-verify-code').addEventListener('click', onVerifyCode);
  document.getElementById('reg-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') onVerifyCode();
  });
  document.getElementById('btn-resend-code').addEventListener('click', async () => {
    if (!currentRegEmail) { showScreen('screen-reg-email'); return; }
    setLoading('btn-resend-code', true, 'Code erneut senden');
    const { error } = await sb.auth.signInWithOtp({
      email: currentRegEmail,
      options: { shouldCreateUser: currentFlow !== 'reset' }
    });
    setLoading('btn-resend-code', false, 'Code erneut senden');
    if (error) {
      setHint('reg-code-hint', 'Fehler: ' + error.message, true);
      return;
    }
    setHint('reg-code-hint', 'Neuer Code wurde gesendet.', false);
    startResendCooldown(60);
  });

  // Registrierung Schritt 3
  document.getElementById('btn-set-password').addEventListener('click', onSetPassword);
  document.getElementById('reg-password2').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSetPassword();
  });

  // Registrierung Schritt 4
  document.getElementById('btn-register').addEventListener('click', onRegister);
  document.getElementById('gamertag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') onRegister();
  });

  // Home
  document.getElementById('btn-ueben').addEventListener('click', () => {
    window.location.href = 'ueben/index.html';
  });
  document.getElementById('btn-geo').addEventListener('click', () => {
    window.location.href = 'geo/index.html';
  });
  document.getElementById('btn-wettkampf').addEventListener('click', () => {
    window.location.href = 'wettkampf/index.html';
  });
  document.getElementById('btn-rangliste').addEventListener('click', () => {
    window.location.href = 'rangliste/index.html';
  });
  document.getElementById('btn-stats').addEventListener('click', showStats);
  document.getElementById('btn-friends').addEventListener('click', showFriends);
  document.getElementById('btn-battle').addEventListener('click', showBattleMenu);
  document.getElementById('btn-battle-menu-back').addEventListener('click', () => {
    document.getElementById('subtitle').textContent = 'Startseite';
    showHome();
  });
  document.getElementById('btn-battle-online').addEventListener('click', () => {
    showToast('Battle Online kommt bald!');
  });
  document.getElementById('btn-battle-vs-friends').addEventListener('click', showBattleFriends);
  document.getElementById('btn-battle-friends-back').addEventListener('click', showBattleMenu);
  document.getElementById('btn-friends-back').addEventListener('click', () => {
    document.getElementById('subtitle').textContent = 'Startseite';
    showHome();
  });
  document.getElementById('btn-friend-stats-back').addEventListener('click', () => {
    showFriends();
  });
  document.getElementById('btn-admin-reports').addEventListener('click', showAdminReports);
  document.getElementById('btn-admin-reports-back').addEventListener('click', showSettings);
  document.getElementById('btn-admin-rangliste').addEventListener('click', showAdminRangliste);
  document.getElementById('btn-admin-rangliste-back').addEventListener('click', showSettings);
  document.getElementById('btn-admin-edit-cancel').addEventListener('click', closeAdminEditModal);
  document.getElementById('btn-admin-edit-save').addEventListener('click', saveAdminEdit);
  document.getElementById('admin-edit-modal').addEventListener('click', e => {
    if (e.target.id === 'admin-edit-modal') closeAdminEditModal();
  });
  document.getElementById('btn-stats-back').addEventListener('click', () => {
    document.getElementById('subtitle').textContent = 'Startseite';
    showHome();
  });
  document.getElementById('btn-history-back').addEventListener('click', () => {
    document.getElementById('subtitle').textContent = 'Statistiken';
    showScreen('screen-stats');
  });

  // Einstellungen
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-settings-back').addEventListener('click', () => {
    document.getElementById('subtitle').textContent = 'Startseite';
    showHome();
  });
  document.getElementById('btn-edit-gamertag').addEventListener('click', () => {
    document.getElementById('gamertag-edit-form').style.display = 'flex';
    document.getElementById('btn-edit-gamertag').style.display = 'none';
    document.getElementById('settings-gamertag-input').focus();
  });
  document.getElementById('settings-gamertag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSaveGamertag();
    if (e.key === 'Escape') collapseGamertagForm();
  });
  document.getElementById('btn-save-gamertag').addEventListener('click', onSaveGamertag);
  document.getElementById('btn-cancel-gamertag').addEventListener('click', collapseGamertagForm);
  document.getElementById('btn-logout').addEventListener('click', onLogout);
  document.getElementById('btn-delete-account').addEventListener('click', onDeleteAccount);

  // Session prüfen beim Start
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    // Verifizieren, dass der User serverseitig noch existiert
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) {
      await sb.auth.signOut();
      showSettingsBtn(false);
      document.getElementById('subtitle').textContent = '';
      showScreen('screen-auth');
    } else {
      afterLogin(user);
    }
  } else {
    showSettingsBtn(false);
    document.getElementById('subtitle').textContent = '';
    showScreen('screen-auth');
  }
});
