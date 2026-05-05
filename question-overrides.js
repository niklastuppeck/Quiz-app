// Lädt Fragen-Overrides (versteckt/bearbeitet) aus Supabase und wendet sie auf QUESTIONS an.
// Muss nach supabase-client.js und data/questions.js geladen werden.

const OVERRIDE_CACHE_KEY = 'quiz_overrides_v1';
const OVERRIDE_CACHE_TTL = 60 * 60 * 1000; // 1 Stunde

async function loadAndApplyOverrides() {
  try {
    const overrides = await _getOverrides();
    _applyOverrides(overrides);
  } catch {}
}

async function _getOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDE_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < OVERRIDE_CACHE_TTL) return parsed.data;
    }
  } catch {}
  return _fetchOverrides();
}

async function _fetchOverrides() {
  try {
    const { data, error } = await sb.from('question_overrides').select('*');
    if (error || !data) return [];
    try {
      localStorage.setItem(OVERRIDE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
    return data;
  } catch {
    return [];
  }
}

function _applyOverrides(overrides) {
  if (!overrides || !overrides.length || typeof QUESTIONS === 'undefined') return;
  for (const override of overrides) {
    outer: for (const topic of Object.values(QUESTIONS)) {
      for (let i = topic.length - 1; i >= 0; i--) {
        if (_overrideHash(topic[i].question) === override.question_hash) {
          if (override.action === 'hidden') {
            topic.splice(i, 1);
          } else if (override.action === 'edited') {
            if (override.new_question) topic[i].question = override.new_question;
            if (override.new_answers) topic[i].answers = override.new_answers;
            if (override.new_correct_index != null) topic[i].correctIndex = override.new_correct_index;
          }
          break outer;
        }
      }
    }
  }
}

function _overrideHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString();
}
