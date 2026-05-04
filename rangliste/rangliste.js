// Rangliste: alle Spieler mit kumulierten Gesamtpunkten — aus Supabase

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getCurrentMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

async function renderLeaderboard() {
  const list  = document.getElementById("leaderboard-list");
  const empty = document.getElementById("leaderboard-empty");

  list.innerHTML = '<p class="loading-hint">Lade Rangliste…</p>';
  empty.setAttribute("hidden", "");

  const since = getCurrentMonthStart();

  try {
    const { data, error } = await sb
      .from('wettkampf_history')
      .select('user_id, gamertag, score, correct, wrong')
      .not('gamertag', 'is', null)
      .gte('played_date', since)
      .order('played_date', { ascending: true });

    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      list.innerHTML = '';
      empty.removeAttribute("hidden");
      return;
    }

    // Kumulieren pro Spieler — nach user_id gruppieren, neuester Gamertag gewinnt
    const map = {};
    data.forEach(entry => {
      const key = entry.user_id || entry.gamertag;
      if (!key) return;
      if (!map[key]) map[key] = { gamertag: entry.gamertag, score: 0, correct: 0, wrong: 0, games: 0 };
      map[key].gamertag = entry.gamertag || map[key].gamertag; // neuesten Gamertag übernehmen
      map[key].score   += entry.score;
      map[key].correct += entry.correct;
      map[key].wrong   += entry.wrong;
      map[key].games++;
    });

    const players = Object.values(map).sort((a, b) => b.score - a.score);
    const rankSymbols = ["🥇", "🥈", "🥉"];

    list.innerHTML = '';
    players.forEach((player, i) => {
      const row = document.createElement("div");
      row.className = `lb-row ${i < 3 ? `top${i + 1}` : ""}`;
      const scorePrefix = player.score > 0 ? "+" : "";
      row.innerHTML = `
        <div class="lb-rank">${rankSymbols[i] || `#${i + 1}`}</div>
        <div class="lb-info">
          <div class="lb-name">${escapeHtml(player.gamertag)}</div>
          <div class="lb-games">${player.games} Spiel${player.games !== 1 ? 'e' : ''}</div>
        </div>
        <div class="lb-score">${scorePrefix}${player.score}</div>
      `;
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<p class="loading-hint">Fehler: ${e.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-back").addEventListener("click", () => {
    window.location.href = "../index.html";
  });

  const now = new Date();
  const monthName = now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const resetStr = nextReset.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  document.getElementById("leaderboard-subtitle").textContent =
    `${monthName} · Reset am ${resetStr}`;

  renderLeaderboard();
});
