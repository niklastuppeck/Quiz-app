// Frage-Melden Modal - geteilt zwischen Üben und Wettkampf
// Erwartet globale Variablen: sb (Supabase-Client), QUESTIONS

function reportQuestionHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString();
}

function reportFindTopicId(question) {
  if (!question || typeof QUESTIONS === 'undefined') return 'unknown';
  for (const [topicId, qs] of Object.entries(QUESTIONS)) {
    if (qs.includes(question)) return topicId;
  }
  return 'unknown';
}

let _reportReason = null;

function reportOpen() {
  _reportReason = null;
  const modal = document.getElementById('report-modal');
  if (!modal) return;
  document.getElementById('report-comment').value = '';
  const hint = document.getElementById('report-hint');
  hint.textContent = '';
  hint.classList.remove('error');
  const sendBtn = document.getElementById('btn-report-send');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Senden';
  document.querySelectorAll('.report-reason').forEach(b => b.classList.remove('selected'));
  modal.style.display = 'flex';
}

function reportClose() {
  const modal = document.getElementById('report-modal');
  if (modal) modal.style.display = 'none';
}

async function reportSend(getCurrentQuestion, getCurrentTopicId) {
  if (!_reportReason) return;
  const q = getCurrentQuestion();
  if (!q) return;
  const topicId = getCurrentTopicId ? getCurrentTopicId(q) : reportFindTopicId(q);

  const hint = document.getElementById('report-hint');
  const sendBtn = document.getElementById('btn-report-send');
  sendBtn.disabled = true;
  sendBtn.textContent = '…';

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    hint.textContent = 'Nicht eingeloggt.';
    hint.classList.add('error');
    sendBtn.disabled = false;
    sendBtn.textContent = 'Senden';
    return;
  }

  const comment = document.getElementById('report-comment').value.trim() || null;
  const { error } = await sb.from('question_reports').insert({
    user_id: session.user.id,
    topic_id: topicId,
    question_hash: reportQuestionHash(q.question),
    question_text: q.question,
    reason: _reportReason,
    comment,
  });

  if (error) {
    if (error.code === '23505') {
      hint.textContent = 'Du hast diese Frage bereits mit diesem Grund gemeldet.';
    } else {
      hint.textContent = 'Fehler: ' + error.message;
    }
    hint.classList.add('error');
    sendBtn.disabled = false;
    sendBtn.textContent = 'Senden';
    return;
  }

  hint.textContent = '✓ Danke fürs Melden!';
  hint.classList.remove('error');
  setTimeout(reportClose, 1200);
}

function wireReportModal(getCurrentQuestion, getCurrentTopicId) {
  const btn = document.getElementById('btn-report');
  if (!btn) return;
  btn.addEventListener('click', reportOpen);
  document.getElementById('btn-report-cancel').addEventListener('click', reportClose);

  document.querySelectorAll('.report-reason').forEach(b => {
    b.addEventListener('click', () => {
      _reportReason = b.dataset.reason;
      document.querySelectorAll('.report-reason').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      document.getElementById('btn-report-send').disabled = false;
    });
  });

  document.getElementById('btn-report-send').addEventListener('click',
    () => reportSend(getCurrentQuestion, getCurrentTopicId));

  document.getElementById('report-modal').addEventListener('click', (e) => {
    if (e.target.id === 'report-modal') reportClose();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') reportClose();
  });
}
