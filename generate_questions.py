#!/usr/bin/env python3
"""
Generiert 100 neue mittel/schwer Fragen pro Thema und fügt sie in questions.js ein.
"""

import os
import re
import json
import time
import anthropic

QUESTIONS_FILE = "/Users/niklastuppeck/quiz-app/data/questions.js"
TARGET_NEW = 100  # pro Thema + Schwierigkeit

TOPICS = {
    "allgemein":    "Allgemeinwissen (bunt gemischte Fragen aus verschiedenen Bereichen des Lebens)",
    "geographie":   "Geographie (Länder, Hauptstädte, Flüsse, Gebirge, Kontinente, Weltgeographie)",
    "politik":      "Politik (Staatsformen, Politiker, internationale Politik, Wahlen, politische Systeme)",
    "geschichte":   "Geschichte (historische Ereignisse, Persönlichkeiten, Epochen, Kriege, Entdeckungen)",
    "wissenschaft": "Wissenschaft (Physik, Chemie, Biologie, Astronomie, Mathematik, Erfindungen)",
    "sport":        "Sport (Sportarten, Athleten, Rekorde, Olympia, Fußball, Weltmeisterschaften)",
}

DIFFICULTY_DESC = {
    "mittel": (
        "MITTEL-Schwierigkeit: Fragen, die allgemeines Schulwissen und etwas Nachdenken erfordern. "
        "Nicht zu einfach (keine offensichtlichen Antworten), aber auch nicht zu spezialisiert. "
        "Jemand mit gutem Allgemeinwissen sollte sie lösen können."
    ),
    "schwer": (
        "SCHWER-Schwierigkeit: Anspruchsvolle Fragen, die tieferes Fachwissen oder sehr gutes "
        "Allgemeinwissen erfordern. Spezifische Zahlen, Jahreszahlen, weniger bekannte Fakten. "
        "Auch Experten sollten manchmal überlegen müssen."
    ),
}

client = anthropic.Anthropic()


def load_existing_questions(content: str, topic: str) -> set:
    topics = list(TOPICS.keys())
    i = topics.index(topic)
    start = content.find(f"  {topic}: [")
    end = content.find(f"  {topics[i+1]}: [") if i + 1 < len(topics) else len(content)
    section = content[start:end]
    questions = re.findall(r'question:\s*"([^"]+)"', section)
    return set(q.lower() for q in questions)


def generate_batch(topic: str, topic_desc: str, difficulty: str, existing: set) -> list:
    existing_sample = list(existing)[:40]
    existing_str = "\n".join(f"- {q}" for q in existing_sample) if existing_sample else "(keine)"

    prompt = f"""Du generierst Quizfragen für eine deutschsprachige Quiz-App.

Thema: {topic_desc}
Schwierigkeit: {DIFFICULTY_DESC[difficulty]}

Bereits vorhandene Fragen (NICHT wiederholen, auch keine thematisch sehr ähnlichen):
{existing_str}

Generiere exakt 25 NEUE Quizfragen zu diesem Thema und Schwierigkeit.

ANFORDERUNGEN:
- Fragen auf Deutsch, grammatikalisch korrekt
- Jede Frage hat genau 4 Antwortmöglichkeiten
- Genau eine richtige Antwort, drei plausible aber falsche Alternativen
- Falsche Antworten müssen zum Thema passen und nicht offensichtlich falsch sein
- Keine Wiederholungen aus der Liste oben
- Fragestellungen klar und eindeutig formuliert
- correctIndex ist 0-basiert (0=erste Antwort, 1=zweite, usw.)
- Verteile die richtige Antwort gleichmäßig über alle Positionen (nicht immer Index 0)

Antworte NUR mit einem JSON-Array, ohne Erklärungen:
[
  {{
    "question": "Frage hier?",
    "answers": ["Antwort A", "Antwort B", "Antwort C", "Antwort D"],
    "correctIndex": 0
  }}
]"""

    for attempt in range(3):
        try:
            message = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}]
            )
            raw = message.content[0].text.strip()
            match = re.search(r'\[.*\]', raw, re.DOTALL)
            if not match:
                raise ValueError("Kein JSON-Array gefunden")
            data = json.loads(match.group())

            result = []
            for q in data:
                if not all(k in q for k in ('question', 'answers', 'correctIndex')):
                    continue
                if len(q['answers']) != 4:
                    continue
                if not (0 <= q['correctIndex'] <= 3):
                    continue
                if q['question'].lower() in existing:
                    print(f"  [skip duplikat] {q['question'][:60]}")
                    continue
                existing.add(q['question'].lower())
                result.append({
                    "difficulty": difficulty,
                    "question": q['question'],
                    "answers": q['answers'],
                    "correctIndex": q['correctIndex'],
                })
            return result

        except Exception as e:
            print(f"  [Fehler Attempt {attempt+1}]: {e}")
            time.sleep(2)
    return []


def questions_to_js(questions: list) -> str:
    lines = []
    for q in questions:
        answers_str = ", ".join(f'"{a}"' for a in q['answers'])
        lines.append(
            f'    {{ difficulty: "{q["difficulty"]}", question: "{q["question"]}", '
            f'answers: [{answers_str}], correctIndex: {q["correctIndex"]} }},'
        )
    return "\n".join(lines)


def insert_questions_into_js(content: str, topic: str, new_questions: list) -> str:
    topics = list(TOPICS.keys())
    i = topics.index(topic)
    if i + 1 < len(topics):
        insert_before = f"  {topics[i+1]}: ["
        pos = content.find(insert_before)
    else:
        pos = content.rfind("};")
    js_lines = questions_to_js(new_questions)
    return content[:pos] + js_lines + "\n" + content[pos:]


def main():
    content = open(QUESTIONS_FILE, encoding="utf-8").read()

    for topic, topic_desc in TOPICS.items():
        for difficulty in ["mittel", "schwer"]:
            existing = load_existing_questions(content, topic)
            print(f"\n{'='*60}")
            print(f"  {topic.upper()} / {difficulty} — {len(existing)} Fragen vorhanden")
            print(f"{'='*60}")

            new_questions = []
            while len(new_questions) < TARGET_NEW:
                print(f"  Batch ({len(new_questions)}/{TARGET_NEW})…")
                batch_result = generate_batch(topic, topic_desc, difficulty, existing)
                new_questions.extend(batch_result)
                print(f"  → {len(batch_result)} erhalten, gesamt: {len(new_questions)}")
                time.sleep(0.5)

            new_questions = new_questions[:TARGET_NEW]
            print(f"  Schreibe {len(new_questions)} Fragen…")
            content = insert_questions_into_js(content, topic, new_questions)

    with open(QUESTIONS_FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\nFertig! {6 * 2 * TARGET_NEW} neue Fragen eingefügt.")


if __name__ == "__main__":
    main()
