-- ============================================================
-- QUIZ APP – SUPABASE SETUP
-- Im Supabase SQL Editor ausführen: https://supabase.com/dashboard
-- Projekt: aunpwdkllsxkypezgdkw
-- ============================================================


-- ============================================================
-- 1. RLS AKTIVIEREN (auf allen Tabellen)
-- ============================================================
ALTER TABLE wettkampf_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wrong_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE battles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_answers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_reports    ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 2. WETTKAMPF_HISTORY
-- Lesen: alle angemeldeten User (für Rangliste)
-- Schreiben: nur eigene Zeile, Score wird per Trigger validiert
-- ============================================================
DROP POLICY IF EXISTS "wettkampf_history_select" ON wettkampf_history;
DROP POLICY IF EXISTS "wettkampf_history_insert" ON wettkampf_history;

CREATE POLICY "wettkampf_history_select"
  ON wettkampf_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "wettkampf_history_insert"
  ON wettkampf_history FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- 3. SCORE-VALIDIERUNGS-TRIGGER
-- Läuft serverseitig BEVOR ein Eintrag gespeichert wird.
-- Prüft: Formel, max. Fragenanzahl, Datum, User-ID.
-- Überschreibt Gamertag automatisch aus der Profil-Tabelle
-- → Client kann Gamertag nicht mehr fälschen.
-- ============================================================
CREATE OR REPLACE FUNCTION validate_wettkampf_score()
RETURNS TRIGGER AS $$
DECLARE
  profile_gamertag TEXT;
BEGIN
  -- user_id muss der eingeloggte User sein
  IF NEW.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Ungültige User-ID';
  END IF;

  -- Score muss exakt correct - wrong sein
  IF NEW.score != NEW.correct - NEW.wrong THEN
    RAISE EXCEPTION 'Ungültiger Score: % != % - %', NEW.score, NEW.correct, NEW.wrong;
  END IF;

  -- Anzahl Fragen darf 15 nicht überschreiten, keine negativen Werte
  IF NEW.correct < 0 OR NEW.wrong < 0 THEN
    RAISE EXCEPTION 'Negative Werte nicht erlaubt';
  END IF;

  IF NEW.correct + NEW.wrong > 15 THEN
    RAISE EXCEPTION 'Mehr als 15 Antworten nicht möglich';
  END IF;

  -- Datum darf höchstens gestern sein (Timezone-Toleranz ±1 Tag)
  IF NEW.played_date < (CURRENT_DATE - INTERVAL '1 day')::date
     OR NEW.played_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Ungültiges Datum: %', NEW.played_date;
  END IF;

  -- Max. 3 Wettkämpfe pro Tag pro User
  IF (
    SELECT COUNT(*) FROM wettkampf_history
    WHERE user_id = auth.uid()
      AND played_date = NEW.played_date
  ) >= 3 THEN
    RAISE EXCEPTION 'Maximal 3 Wettkämpfe pro Tag erlaubt';
  END IF;

  -- Gamertag aus Profil-Tabelle holen – Client-Wert wird ignoriert
  SELECT gamertag INTO profile_gamertag
    FROM profiles WHERE user_id = auth.uid();
  NEW.gamertag := COALESCE(profile_gamertag, '');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS validate_wettkampf_score_trigger ON wettkampf_history;
CREATE TRIGGER validate_wettkampf_score_trigger
  BEFORE INSERT ON wettkampf_history
  FOR EACH ROW EXECUTE FUNCTION validate_wettkampf_score();


-- ============================================================
-- 4. PROFILES
-- Lesen: alle angemeldeten User (für Gamertag-Suche, Battle)
-- Schreiben: nur eigenes Profil
-- ============================================================
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;

CREATE POLICY "profiles_select"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- 5. TOPIC_STATS
-- Lesen: alle angemeldeten User (für Freund-Statistiken)
-- Schreiben: nur eigene Stats
-- ============================================================
DROP POLICY IF EXISTS "topic_stats_select" ON topic_stats;
DROP POLICY IF EXISTS "topic_stats_insert" ON topic_stats;
DROP POLICY IF EXISTS "topic_stats_update" ON topic_stats;

CREATE POLICY "topic_stats_select"
  ON topic_stats FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "topic_stats_insert"
  ON topic_stats FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "topic_stats_update"
  ON topic_stats FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- 6. WRONG_QUESTIONS
-- Lesen: alle angemeldeten User (für Freund-Statistiken)
-- Schreiben: nur eigene Einträge
-- ============================================================
DROP POLICY IF EXISTS "wrong_questions_select" ON wrong_questions;
DROP POLICY IF EXISTS "wrong_questions_insert" ON wrong_questions;
DROP POLICY IF EXISTS "wrong_questions_delete" ON wrong_questions;

CREATE POLICY "wrong_questions_select"
  ON wrong_questions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "wrong_questions_insert"
  ON wrong_questions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "wrong_questions_delete"
  ON wrong_questions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- 7. BATTLES
-- Lesen: Host oder Gast der Battle
-- Schreiben: Host oder Gast der Battle
-- ============================================================
DROP POLICY IF EXISTS "battles_select" ON battles;
DROP POLICY IF EXISTS "battles_insert" ON battles;
DROP POLICY IF EXISTS "battles_update" ON battles;
DROP POLICY IF EXISTS "battles_delete" ON battles;

CREATE POLICY "battles_select"
  ON battles FOR SELECT
  TO authenticated
  USING (host_id = auth.uid() OR guest_id = auth.uid());

CREATE POLICY "battles_insert"
  ON battles FOR INSERT
  TO authenticated
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "battles_update"
  ON battles FOR UPDATE
  TO authenticated
  USING (host_id = auth.uid() OR guest_id = auth.uid());

CREATE POLICY "battles_delete"
  ON battles FOR DELETE
  TO authenticated
  USING (host_id = auth.uid());


-- ============================================================
-- 8. BATTLE_ANSWERS
-- Lesen: Host oder Gast der zugehörigen Battle
-- Schreiben: nur eigene Antworten
-- ============================================================
DROP POLICY IF EXISTS "battle_answers_select" ON battle_answers;
DROP POLICY IF EXISTS "battle_answers_insert" ON battle_answers;

CREATE POLICY "battle_answers_select"
  ON battle_answers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM battles
      WHERE battles.id = battle_answers.battle_id
        AND (battles.host_id = auth.uid() OR battles.guest_id = auth.uid())
    )
  );

CREATE POLICY "battle_answers_insert"
  ON battle_answers FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- 9. FRIENDSHIPS
-- Lesen: User ist Absender oder Empfänger
-- Schreiben: Anfrage senden (requester = ich), annehmen/ablehnen (addressee = ich)
-- Löschen: beide Parteien dürfen
-- ============================================================
DROP POLICY IF EXISTS "friendships_select" ON friendships;
DROP POLICY IF EXISTS "friendships_insert" ON friendships;
DROP POLICY IF EXISTS "friendships_update" ON friendships;
DROP POLICY IF EXISTS "friendships_delete" ON friendships;

CREATE POLICY "friendships_select"
  ON friendships FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE POLICY "friendships_insert"
  ON friendships FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "friendships_update"
  ON friendships FOR UPDATE
  TO authenticated
  USING (addressee_id = auth.uid() OR requester_id = auth.uid());

CREATE POLICY "friendships_delete"
  ON friendships FOR DELETE
  TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());


-- ============================================================
-- 10. QUESTION_REPORTS
-- Lesen: nur Admins (is_admin = true in profiles)
-- Schreiben: alle angemeldeten User
-- Aktualisieren: nur Admins
-- ============================================================
DROP POLICY IF EXISTS "question_reports_select" ON question_reports;
DROP POLICY IF EXISTS "question_reports_insert" ON question_reports;
DROP POLICY IF EXISTS "question_reports_update" ON question_reports;

CREATE POLICY "question_reports_select"
  ON question_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "question_reports_insert"
  ON question_reports FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "question_reports_update"
  ON question_reports FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = auth.uid() AND is_admin = true
    )
  );


-- ============================================================
-- FERTIG!
-- Alle Policies aktiv, Score-Trigger läuft serverseitig.
-- ============================================================
