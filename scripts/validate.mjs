// Prüft Turnierdateien, bevor sie nach main gehen. Ohne Abhängigkeiten:
//   node scripts/validate.mjs [datei.json ...]   (ohne Angabe: alle Dateien unter data/)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dieselben Namen wie normalizeRound in der App. Andere Namen bekommen dort kein Preisgeld.
const ROUNDS = new Set([
  'round_of_128', 'round_of_64', 'round_of_32', 'round_of_16',
  'quarterfinal', 'quarterfinals', 'quarter_final', 'quarter_finals',
  'semifinal', 'semifinals', 'semi_final', 'semi_finals', 'final',
]);
const ROUND_ROBIN = 'round_robin'; // Nur bei den ATP Finals, die die App noch nicht abrechnet.
const CATEGORIES = new Set(['atp_250', 'atp_500', 'masters_1000', 'grand_slam', 'atp_finals']);
const STATUSES = new Set(['scheduled', 'live', 'finished']);
const STAT_KEYS = ['aces', 'double_faults', 'breakpoints_won', 'breakpoints_total', 'service_games_won', 'tiebreaks_won'];

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isSetComplete = (s) => {
  const hi = Math.max(s.p1, s.p2);
  const lo = Math.min(s.p1, s.p2);
  return Boolean(s.tiebreak) || (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
};

// Spiele minus Tiebreak-Spiel = gehaltene Aufschlagspiele + Breaks. Daraus folgt für beide Spieler:
// Differenz der gewonnenen Spiele = Differenz der Aufschlagspiele + 2 × Differenz der Breaks.
function checkBreaks(match, a, b, fail, warn) {
  const games = { a: 0, b: 0 };
  for (const s of match.sets) {
    games.a += s.p1 - (s.tiebreak && s.p1 > s.p2 ? 1 : 0);
    games.b += s.p2 - (s.tiebreak && s.p2 > s.p1 ? 1 : 0);
  }
  const servedA = a.service_games_won + b.breakpoints_won;
  const servedB = b.service_games_won + a.breakpoints_won;
  const report = match.retired ? warn : fail;
  if (servedA + servedB !== games.a + games.b) {
    report(`Aufschlagspiele ${servedA}+${servedB} passen nicht zu ${games.a + games.b} Spielen`);
  }
  const breakDiff = (games.a - games.b - (servedA - servedB)) / 2;
  if (breakDiff !== a.breakpoints_won - b.breakpoints_won) {
    report(`Breaks ${a.breakpoints_won}:${b.breakpoints_won} passen nicht zum Ergebnis, erwartet Differenz ${breakDiff}. Vermutlich Werte vertauscht`);
  }
}

function checkMatch(match, data, fail, warn) {
  const { id, round, status, player1, player2, winner, sets, stats } = match;
  if (!id) fail('ohne id');
  if (!ROUNDS.has(round) && !(round === ROUND_ROBIN && data.tournament.category === 'atp_finals')) fail(`Runde "${round}" kennt die App nicht`);
  if (!STATUSES.has(status)) fail(`Status "${status}" ungültig`);
  if (!match.start || Number.isNaN(Date.parse(match.start))) fail('start fehlt oder ist kein Zeitpunkt');
  for (const p of [player1, player2]) if (!data.players?.[p]) fail(`Spieler ${p} fehlt in players`);
  if (player1 === player2) fail('Spieler gegen sich selbst');
  if (status !== 'finished') {
    if (winner) fail('Sieger, obwohl nicht beendet');
    return;
  }
  if (winner !== player1 && winner !== player2) fail('beendet, aber Sieger ist keiner der beiden');
  if (match.walkover && match.retired) fail('Walkover und Aufgabe zugleich');
  if (match.walkover) {
    if (sets?.length || stats) fail('Walkover mit Sätzen oder Statistik');
    return;
  }
  if (!sets?.length) return fail('beendet, aber keine Sätze');
  for (const s of sets) {
    if (!isCount(s.p1) || !isCount(s.p2)) fail(`Satz ungültig: ${JSON.stringify(s)}`);
    if (s.tiebreak && Math.max(s.p1, s.p2) !== 7) fail(`Tiebreak in einem Satz ${s.p1}:${s.p2}`);
    if (Math.max(s.p1, s.p2) === 7 && Math.min(s.p1, s.p2) === 6 && !s.tiebreak) fail(`Satz ${s.p1}:${s.p2} ohne Tiebreak`);
    if (s.tiebreak && (s.tiebreak.p1 > s.tiebreak.p2) !== (s.p1 > s.p2)) fail(`Tiebreak-Sieger passt nicht zum Satz ${s.p1}:${s.p2}`);
    if (s.tiebreak && (Math.max(s.tiebreak.p1, s.tiebreak.p2) < 7 || Math.abs(s.tiebreak.p1 - s.tiebreak.p2) < 2)) fail(`Tiebreak ${s.tiebreak.p1}:${s.tiebreak.p2} unmöglich`);
  }
  const complete = sets.filter(isSetComplete);
  if (complete.length !== sets.length && !match.retired) fail('offener Satz ohne retired');
  if (!match.retired) {
    const wonByP1 = complete.filter((s) => s.p1 > s.p2).length;
    const wonByP2 = complete.length - wonByP1;
    const need = Math.ceil((data.tournament.best_of ?? 3) / 2);
    const actual = winner === player1 ? wonByP1 : wonByP2;
    if (actual !== need || Math.max(wonByP1, wonByP2) !== need) fail(`Satzstand ${wonByP1}:${wonByP2} passt nicht zum Sieger`);
  }
  if (!stats) return warn('beendet, aber ohne Statistik');
  const a = stats[player1];
  const b = stats[player2];
  if (!a || !b) return fail('Statistik nicht für beide Spieler');
  for (const key of STAT_KEYS) {
    if (!isCount(a[key]) || !isCount(b[key])) fail(`Statistikfeld ${key} fehlt oder ist ungültig`);
  }
  if (a.breakpoints_won > a.breakpoints_total || b.breakpoints_won > b.breakpoints_total) fail('mehr Breaks als Breakbälle');
  const tiebreaksP1 = sets.filter((s) => s.tiebreak && s.p1 > s.p2).length;
  const tiebreaksP2 = sets.filter((s) => s.tiebreak && s.p2 > s.p1).length;
  if (a.tiebreaks_won !== tiebreaksP1 || b.tiebreaks_won !== tiebreaksP2) fail('tiebreaks_won passt nicht zu sets');
  checkBreaks(match, a, b, fail, warn);
}

export function validate(data) {
  const errors = [];
  const warnings = [];
  const t = data.tournament ?? {};
  for (const key of ['id', 'name', 'category', 'country', 'start', 'end', 'best_of', 'draw_size']) {
    if (t[key] == null) errors.push(`tournament.${key} fehlt`);
  }
  if (t.category && !CATEGORIES.has(t.category)) errors.push(`Kategorie "${t.category}" ungültig`);
  if (t.draw_size != null && !isCount(t.draw_size)) errors.push('draw_size ist keine Zahl');
  if (!data.updated_at || Number.isNaN(Date.parse(data.updated_at))) errors.push('updated_at fehlt oder ist kein Zeitpunkt');

  const players = Object.entries(data.players ?? {});
  if (players.length < (t.draw_size ?? 0)) {
    const message = `nur ${players.length} Spieler bei Feldgröße ${t.draw_size}`;
    // Vor dem Ende der Qualifikation stehen nicht alle Namen fest.
    if (t.qualifiers_pending) warnings.push(`${message}, Qualifikation läuft noch`);
    else errors.push(`${message}: Auszug`);
  }
  const seeds = new Set();
  for (const [id, p] of players) {
    if (!p.name) errors.push(`${id}: name fehlt`);
    if (!p.country) errors.push(`${id}: country fehlt`);
    if (p.seed !== null && !(Number.isInteger(p.seed) && p.seed > 0)) errors.push(`${id}: seed ungültig`);
    if (p.seed !== null) {
      if (seeds.has(p.seed)) errors.push(`Setzung ${p.seed} doppelt`);
      seeds.add(p.seed);
    }
    if (p.form_wins_last10 !== null && !(isCount(p.form_wins_last10) && p.form_wins_last10 <= 10)) errors.push(`${id}: form_wins_last10 ungültig`);
    if (!('form_wins_last10' in p)) errors.push(`${id}: form_wins_last10 fehlt`);
  }
  if (t.category !== 'atp_finals' && players.length > 0) {
    const missingTop = [1, 2, 3, 4].filter((seed) => !seeds.has(seed));
    if (missingTop.length) warnings.push(`Top-4-Setzungen fehlen: ${missingTop.join(', ')}. Das Favoritenlimit greift dann nicht vollständig`);
  }

  const ids = new Set();
  const lost = new Map();
  const matches = data.matches ?? [];
  for (const m of matches) {
    const fail = (msg) => errors.push(`${m.id ?? '?'}: ${msg}`);
    const warn = (msg) => warnings.push(`${m.id ?? '?'}: ${msg}`);
    if (ids.has(m.id)) fail('id doppelt');
    ids.add(m.id);
    checkMatch(m, data, fail, warn);
    if (m.status === 'finished' && m.round !== ROUND_ROBIN && m.winner) {
      lost.set(m.winner === m.player1 ? m.player2 : m.player1, m);
    }
  }
  // Wer im K.-o.-Feld verloren hat, darf in keiner späteren Runde mehr auftauchen.
  const order = ['round_of_128', 'round_of_64', 'round_of_32', 'round_of_16', 'quarter', 'semi', 'final'];
  const rank = (round) => order.findIndex((r) => round?.startsWith(r));
  for (const m of matches) {
    for (const p of [m.player1, m.player2]) {
      const defeat = lost.get(p);
      if (defeat && defeat !== m && rank(m.round) > rank(defeat.round)) errors.push(`${m.id}: ${p} ist schon in ${defeat.round} ausgeschieden`);
    }
  }
  return { errors, warnings };
}

function dataFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return dataFiles(path);
    return name.endsWith('.json') ? [path] : [];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../data/', import.meta.url));
  const files = process.argv.length > 2 ? process.argv.slice(2) : dataFiles(root);
  let failed = false;
  for (const file of files) {
    const { errors, warnings } = validate(JSON.parse(readFileSync(file, 'utf8')));
    console.log(`${file}: ${errors.length} Fehler, ${warnings.length} Hinweise`);
    for (const w of warnings) console.log(`  Hinweis: ${w}`);
    for (const e of errors) console.log(`  FEHLER: ${e}`);
    failed ||= errors.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
