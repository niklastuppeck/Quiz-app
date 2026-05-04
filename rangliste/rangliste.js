// Rangliste: alle Spieler mit kumulierten Gesamtpunkten — aus Supabase

const { createClient } = window.supabase;
const sb = createClient(
  'https://aunpwdkllsxkypezgdkw.supabase.co',
  'sb_publishable_CMHytnfreZdmS9U8jNy9qg_0-cbi5I-'
);

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
      .select('gamertag, score, correct, wrong')
      .not('gamertag', 'is', null)
      .gte('played_date', since);

    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      list.innerHTML = '';
      empty.removeAttribute("hidden");
      return;
    }

    // Kumulieren pro Spieler
    const map = {};
    data.forEach(entry => {
      const name = entry.gamertag;
      if (!name) return;
      if (!map[name]) map[name] = { gamertag: name, score: 0, correct: 0, wrong: 0, games: 0 };
      map[name].score   += entry.score;
      map[name].correct += entry.correct;
      map[name].wrong   += entry.wrong;
      map[name].games++;
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
          <div class="lb-name">${player.gamertag}</div>
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
