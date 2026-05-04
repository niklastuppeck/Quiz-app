// Eigenständiges Battle-Invite-Modul – auf jeder Seite einbindbar
(function () {
  const sb = window.sb;

  let currentInvite = null;
  let inviteChannel = null;

  function getBattlePath() {
    const path = window.location.pathname;
    const inSub = /\/(ueben|wettkampf|rangliste|battle)\//.test(path);
    return inSub ? '../battle/index.html' : 'battle/index.html';
  }

  function topicLabel(id) {
    if (typeof TOPICS === 'undefined') return '🎲 Mix';
    const t = TOPICS.find(t => t.id === id);
    return t ? `${t.icon} ${t.name}` : '🎲 Mix';
  }

  function diffLabel(d) {
    return d === 'leicht' ? '😊 Leicht'
         : d === 'mittel' ? '⚡ Mittel'
         : d === 'schwer' ? '🔥 Schwer' : '🎲 Mix';
  }

  function injectHTML() {
    if (document.getElementById('battle-invite-toast')) return;
    const el = document.createElement('div');
    el.id = 'battle-invite-toast';
    el.className = 'battle-invite-toast';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="bit-inner">
        <div class="bit-header">
          <span class="bit-sword">⚔️</span>
          <span class="bit-label">Battle-Einladung</span>
        </div>
        <div class="bit-title" id="bit-title">Herausforderung!</div>
        <div class="bit-sub" id="bit-sub"></div>
        <div class="bit-actions">
          <button class="bit-btn-accept" id="bit-accept">Annehmen</button>
          <button class="bit-btn-decline" id="bit-decline">Ablehnen</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('bit-accept').addEventListener('click', () => {
      if (!currentInvite) return;
      const id = currentInvite.id;
      hideToast();
      window.location.href = `${getBattlePath()}?battleId=${id}`;
    });

    document.getElementById('bit-decline').addEventListener('click', async () => {
      if (!currentInvite) return;
      await sb.from('battles').update({ status: 'declined' }).eq('id', currentInvite.id);
      hideToast();
    });
  }

  function showToast(battle, hostTag) {
    currentInvite = battle;
    const count = battle.question_count || 10;
    document.getElementById('bit-title').textContent = `${hostTag} fordert dich heraus!`;
    document.getElementById('bit-sub').textContent =
      `${topicLabel(battle.topic_id)} · ${diffLabel(battle.difficulty)} · ${count} Fragen`;

    const toast = document.getElementById('battle-invite-toast');
    toast.style.display = '';
    toast.classList.remove('bit-in');
    void toast.offsetWidth;
    toast.classList.add('bit-in');
  }

  function hideToast() {
    currentInvite = null;
    const toast = document.getElementById('battle-invite-toast');
    if (toast) toast.style.display = 'none';
  }

  async function showInviteFor(battle) {
    const { data: profile } = await sb
      .from('profiles').select('gamertag')
      .eq('user_id', battle.host_id).maybeSingle();
    showToast(battle, profile?.gamertag || '?');
  }

  async function init() {
    injectHTML();

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const userId = session.user.id;

    // Bereits vorhandene Einladung prüfen
    const { data } = await sb.from('battles').select('*')
      .eq('guest_id', userId)
      .eq('status', 'invited')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) showInviteFor(data);

    // Neue Einladungen in Echtzeit empfangen
    inviteChannel = sb.channel('battle-invites-' + userId)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'battles',
        filter: `guest_id=eq.${userId}`,
      }, payload => showInviteFor(payload.new))
      .subscribe();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
