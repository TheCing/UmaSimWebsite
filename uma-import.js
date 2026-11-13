// Turn umas saved by other Uma Musume tools into runner JSON.
//
// Sources (see convertUmaJson for how each is recognised):
// - The game's own trained-uma record (`trained_chara`): UmaExtractor / Trackside "data.json",
//   umadump "trained_chara_data.json" and veteran.json, horseACT "veterans.json". Race dumps
//   hold the same record as `race_horse_data` (power spelled `pow`, plus `chara_id` and
//   `motivation`), and career packets as `chara_info` (style in `race_running_style`).
// - Race dumps: Trackside CM dumps (`race_horse_data_array`), and horseACT / Trackside /
//   UmaLauncher race files (`<RaceHorse>k__BackingField`, or plain `raceHorse`): the player's umas.
// - UmaLauncher training logs: game packets written one after another (not one JSON value);
//   the last `chara_info` is the finished uma.
// - UmaLauncher account exports (`raised_characters`): no skill ids, so only the unique is added.
// - Trackside Dashboard Team Trials history (JSON Lines): no aptitudes, so the costume's
//   defaults are used.
// - Moomoolator (uma-tools) uma JSON: runner JSON keyed by `outfitId` instead of `charaId`.
//
// Game records keep every aptitude (four distances, two surfaces) while a runner has one of each,
// so the distance and surface aptitudes follow the course being raced; without a course the best
// of each is used.
import { isSkill, isUma } from './globalsim/index.js';
import { isOwnUnique } from './hakuraku-import.js';
import { OUTFITS } from './outfits.js';

const GRADES = { 1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S' };
const STYLES = { 1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi' };
const STRATEGY_ORDER = ['Nige', 'Senkou', 'Sasi', 'Oikomi'];
const STYLE_APTITUDE = {
  Nige: 'proper_running_style_nige', Senkou: 'proper_running_style_senko',
  Sasi: 'proper_running_style_sashi', Oikomi: 'proper_running_style_oikomi',
};
const DISTANCES = ['proper_distance_short', 'proper_distance_mile', 'proper_distance_middle', 'proper_distance_long'];
const SURFACES = ['proper_ground_turf', 'proper_ground_dirt'];
const RUNAWAY = 202051; // with this skill a front runner races as Oonige
const RANKS = 'GFEDCBAS';
const LETTER_STYLES = { // UmaLauncher labels and Trackside's upper-case names
  runner: 'Nige', leader: 'Senkou', betweener: 'Sasi', chaser: 'Oikomi',
  nige: 'Nige', senko: 'Senkou', senkou: 'Senkou', sashi: 'Sasi', sasi: 'Sasi', oikomi: 'Oikomi',
  oonige: 'Oonige', runaway: 'Oonige',
};
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Parse an uploaded file's text: one JSON value, JSON objects written one after another with
 * commas between them (UmaLauncher training logs), or JSON Lines. Throws the JSON error otherwise.
 */
export function parseUmaText(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    try { return JSON.parse(`[${text}]`); } catch { /* not comma-separated objects */ }
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > 1) {
      try { return lines.map((line) => JSON.parse(line)); } catch { /* not JSON Lines */ }
    }
    throw error;
  }
}

// ---- game records ---------------------------------------------------------------------------

/** Whether `value` looks like a game trained_chara / race_horse_data / chara_info record. */
export function isTrainedChara(value) {
  return isObject(value) && Number.isInteger(value.card_id) && typeof value.wiz === 'number'
    && Array.isArray(value.skill_array);
}

/** A trained uma rather than an NPC (race dumps include mobs with no card). */
const isTrainedUma = (value) => isTrainedChara(value) && value.card_id > 0 && !(value.mob_id > 0);

function grade(raw, field) {
  const letter = GRADES[raw[field]];
  if (!letter) throw new Error(`invalid aptitude ${field}: ${raw[field]}`);
  return letter;
}

/** The field for the course's bucket (category 1-4 / surface 1-2), or the best-graded field. */
function pick(raw, fields, index) {
  if (fields[index]) return fields[index];
  return fields.reduce((best, field) => ((raw[field] ?? 0) > (raw[best] ?? 0) ? field : best));
}

/** Runner skills from [id, level] pairs; ids the catalog doesn't know go to `skipped`. */
function skillsFrom(pairs, skipped) {
  const skills = [];
  for (const [rawId, level] of pairs) {
    const id = Number(rawId);
    if (!isSkill(id)) { skipped.push(rawId); continue; }
    if (skills.some((s) => s.skillId === String(id))) continue;
    skills.push({ skillId: String(id), level: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1, isUnique: isOwnUnique(id) });
  }
  return skills;
}

function requireUma(charaId, cardId) {
  if (!isUma(charaId)) throw new Error(`unknown character ${charaId}${cardId ? ` (card ${cardId})` : ''}`);
}

/**
 * Runner JSON (plus `outfitId`, the costume) for one trained_chara, race_horse_data or chara_info
 * record. `course` ({ surface, category }) picks the distance and surface aptitudes;
 * `runningStyleEx` is a race dump's extended style ('Oonige' / 'Runaway' make it Oonige).
 * Skills the catalog doesn't know are left out and listed in `skipped`.
 */
export function runnerFromTrainedChara(raw, course = null, { runningStyleEx = null } = {}) {
  if (!isTrainedChara(raw)) throw new Error('not a trained uma record');
  const charaId = Number.isInteger(raw.chara_id) && raw.chara_id < 10000 ? raw.chara_id : Math.floor(raw.card_id / 100);
  requireUma(charaId, raw.card_id);
  const style = raw.running_style ?? raw.race_running_style;
  let strategy = STYLES[style];
  if (!strategy) throw new Error(`unknown running_style ${style}`);
  const strategyAptitude = grade(raw, STYLE_APTITUDE[strategy]);
  const ex = String(runningStyleEx ?? '').toLowerCase();
  if (strategy === 'Nige' && (ex === 'oonige' || ex === 'runaway' || raw.skill_array.some((s) => Number(s?.skill_id) === RUNAWAY))) {
    strategy = 'Oonige';
  }
  const skipped = [];
  const runner = {
    charaId,
    speed: raw.speed, stamina: raw.stamina, power: raw.power ?? raw.pow, guts: raw.guts, wisdom: raw.wiz,
    strategy,
    distanceAptitude: grade(raw, pick(raw, DISTANCES, course ? course.category - 1 : -1)),
    surfaceAptitude: grade(raw, pick(raw, SURFACES, course ? course.surface - 1 : -1)),
    strategyAptitude,
    skills: skillsFrom(raw.skill_array.map((s) => [s?.skill_id, s?.level]), skipped),
    outfitId: raw.card_id,
  };
  // Race dumps and career packets carry the uma's mood (motivation 1-5).
  if (Number.isInteger(raw.motivation) && raw.motivation >= 1 && raw.motivation <= 5) runner.mood = raw.motivation - 3;
  return { runner, skipped };
}

// ---- other tools' shapes --------------------------------------------------------------------

/** An outfit's own unique skill id (3★ costumes), e.g. 104201 -> 100421. */
function uniqueOf(cardId) {
  const s = String(cardId);
  const id = 100000 + 10000 * (Number(s.slice(-2)) - 1) + Number(s.slice(1, -2)) * 10 + 1;
  return isSkill(id) ? id : null;
}

/** The costume's default aptitude letters (Sprint Mile Medium Long | Front Pace Late End | Turf Dirt). */
function outfitAptitudes(charaId, cardId) {
  const outfits = OUTFITS[charaId] ?? [];
  return (outfits.find((o) => o.id === cardId) ?? outfits[0])?.aptitudes ?? null;
}

const best = (letters) => [...letters].sort((a, b) => RANKS.indexOf(b) - RANKS.indexOf(a))[0];

/** UmaLauncher account export entry: letter aptitudes, no skill ids (only the unique is added). */
function runnerFromAccountEntry(entry, course) {
  const charaId = Math.floor(entry.card_id / 100);
  requireUma(charaId, entry.card_id);
  const strategy = LETTER_STYLES[String(entry.running_style).toLowerCase()];
  if (!strategy) throw new Error(`unknown running_style ${entry.running_style}`);
  const apt = entry.aptitudes ?? {};
  const distances = [apt.short, apt.mile, apt.middle, apt.long];
  const surfaces = [apt.turf, apt.dirt];
  const styleKey = { Nige: 'runner', Oonige: 'runner', Senkou: 'leader', Sasi: 'betweener', Oikomi: 'chaser' }[strategy];
  const unique = uniqueOf(entry.card_id);
  const level = Number.isInteger(entry.talent_level) ? entry.talent_level : 1;
  const runner = {
    charaId,
    speed: entry.stats?.speed, stamina: entry.stats?.stamina, power: entry.stats?.power,
    guts: entry.stats?.guts, wisdom: entry.stats?.wisdom ?? entry.stats?.wiz,
    strategy,
    distanceAptitude: course ? distances[course.category - 1] : best(distances),
    surfaceAptitude: course ? surfaces[course.surface - 1] : best(surfaces),
    strategyAptitude: apt[styleKey],
    skills: unique ? [{ skillId: String(unique), level: Math.min(6, Math.max(1, level)), isUnique: true }] : [],
    outfitId: entry.card_id,
  };
  return { runner, skipped: [] };
}

/** Trackside Dashboard Team Trials row: no aptitudes (costume defaults) and no skill levels. */
function runnerFromTeamTrialsRow(row, course) {
  const cardId = row.chara_id > 9999 ? row.chara_id : row.card_id;
  const charaId = Math.floor(cardId / 100);
  requireUma(charaId, cardId);
  const strategy = LETTER_STYLES[String(row.running_style).toLowerCase()];
  if (!strategy) throw new Error(`unknown running_style ${row.running_style}`);
  const apt = outfitAptitudes(charaId, cardId);
  if (!apt) throw new Error(`no default aptitudes for character ${charaId}`);
  const skipped = [];
  const ids = row.owned_skills ?? [];
  const runner = {
    charaId,
    speed: row.stats.speed, stamina: row.stats.stamina, power: row.stats.power ?? row.stats.pow,
    guts: row.stats.guts, wisdom: row.stats.wiz ?? row.stats.wisdom,
    strategy,
    distanceAptitude: course ? apt[course.category - 1] : best(apt.slice(0, 4)),
    surfaceAptitude: course ? apt[8 + course.surface - 1] : best(apt.slice(8, 10)),
    strategyAptitude: apt[4 + STRATEGY_ORDER.indexOf(strategy === 'Oonige' ? 'Nige' : strategy)],
    skills: skillsFrom(ids.map((id) => [id, 1]), skipped),
    outfitId: cardId,
  };
  if (strategy === 'Nige' && ids.map(Number).includes(RUNAWAY)) runner.strategy = 'Oonige';
  return { runner, skipped };
}

/** Moomoolator uma JSON: `outfitId` instead of `charaId`, the unique's level in `uniqueLv`. */
function runnerFromMoomoolator(data) {
  const cardId = Number(data.outfitId);
  const charaId = Math.floor(cardId / 100);
  requireUma(charaId, cardId);
  const { outfitId, starCount, uniqueLv, forcedSkillPositions, skills: ids = [], ...rest } = data;
  const level = Number.isInteger(uniqueLv) ? uniqueLv : 1;
  const unique = uniqueOf(cardId);
  const pairs = ids.map((id) => [isObject(id) ? id.skillId : id, null]);
  if (unique && !pairs.some(([id]) => Number(id) === unique)) pairs.unshift([unique, null]);
  const skipped = [];
  const skills = skillsFrom(pairs, skipped).map((s) => (s.isUnique ? { ...s, level } : s));
  return { runner: { ...rest, charaId, skills, outfitId: cardId }, skipped };
}

// ---- recognising a file ---------------------------------------------------------------------

const isAccountExport = (json) => isObject(json) && Array.isArray(json.raised_characters);
const isTeamTrialsRow = (value) => isObject(value) && isObject(value.stats) && 'trial_id' in value
  && Array.isArray(value.owned_skills);
const isMoomoolator = (value) => isObject(value) && value.outfitId != null && !('charaId' in value)
  && typeof value.wisdom === 'number' && typeof value.strategy === 'string';
const raceHorsesOf = (json) => (isObject(json) ? json['<RaceHorse>k__BackingField'] ?? json.raceHorse : null);

/** The player's horses in a race dump ({ data, runningStyleEx }), or every trained uma if unknown. */
function playerHorses(json) {
  const horses = raceHorsesOf(json) ?? [];
  const team = json['<PlayerTeamMemberArray>k__BackingField'] ?? json.playerTeamMemberArray;
  const index = json._playerHorseIndex ?? json.playerHorseIndex;
  const trained = (list) => list
    .map((horse) => ({ data: horse?._responseHorseData ?? horse?.responseHorseData, runningStyleEx: horse?._runningStyleEx ?? horse?.runningStyleEx }))
    .filter(({ data }) => isTrainedUma(data));
  // Some races list NPCs as the "team"; then try the player's own horse, then everyone.
  for (const list of [Array.isArray(team) ? team : [], Number.isInteger(index) && horses[index] ? [horses[index]] : [], horses]) {
    const found = trained(list);
    if (found.length) return found;
  }
  return [];
}

/**
 * Work out which tool `json` came from. Returns the uma records and how to convert each
 * ({ label, records, convert }), or null for JSON that isn't one of these sources.
 */
function recognise(json, course) {
  const fromGame = (record) => runnerFromTrainedChara(record, course);
  if (Array.isArray(json)) {
    if (json.length && json.every(isTrainedChara)) return { label: 'game records', records: json.filter(isTrainedUma), convert: fromGame };
    if (json.length && json.every(isTeamTrialsRow)) {
      // One row per race: keep the latest row of each uma.
      const byUma = new Map(json.map((row) => [row.trained_chara_id ?? JSON.stringify(row.stats), row]));
      return { label: 'Team Trials history', records: [...byUma.values()], convert: (row) => runnerFromTeamTrialsRow(row, course) };
    }
    if (json.length && json.every(isMoomoolator)) return { label: 'Moomoolator', records: json, convert: runnerFromMoomoolator };
    const packet = json.findLast?.((item) => isObject(item) && isTrainedChara(item.chara_info));
    if (packet) return { label: 'training log', records: [packet.chara_info], convert: fromGame };
    return null;
  }
  if (!isObject(json)) return null;
  if (isTrainedChara(json)) return { label: 'game record', records: [json], convert: fromGame };
  if (isTrainedChara(json.chara_info)) return { label: 'training log', records: [json.chara_info], convert: fromGame };
  // The game's account load response (`trained_chara`: every veteran).
  if (Array.isArray(json.trained_chara) && json.trained_chara.some(isTrainedChara)) {
    return { label: 'game records', records: json.trained_chara.filter(isTrainedUma), convert: fromGame };
  }
  if (Array.isArray(json.race_horse_data_array)) {
    return { label: 'race dump', records: json.race_horse_data_array.filter(isTrainedUma), convert: fromGame };
  }
  if (Array.isArray(raceHorsesOf(json))) {
    return { label: 'race dump', records: playerHorses(json), convert: ({ data, runningStyleEx }) => runnerFromTrainedChara(data, course, { runningStyleEx }) };
  }
  if (isAccountExport(json)) return { label: 'account export', records: json.raised_characters, convert: (e) => runnerFromAccountEntry(e, course) };
  if (isTeamTrialsRow(json)) return { label: 'Team Trials history', records: [json], convert: (row) => runnerFromTeamTrialsRow(row, course) };
  if (isMoomoolator(json)) return { label: 'Moomoolator', records: [json], convert: runnerFromMoomoolator };
  return null;
}

/** What a source leaves out, said once per file. */
const CAVEATS = {
  'account export': 'UmaLauncher account exports have no skill list, so only each uma\'s unique was added',
  'Team Trials history': 'Team Trials history has no aptitudes, so each costume\'s default aptitudes were used',
};

/**
 * If `json` comes from one of the tools above, the converted runners and what to tell the user
 * ({ runners, skipped: number of unknown skills dropped, notes: [string] }); otherwise null.
 * `limit` stops after that many umas (the editor needs one).
 */
export function convertUmaJson(json, course = null, { limit = Infinity } = {}) {
  const found = recognise(json, course);
  if (!found) return null;
  const records = found.records.slice(0, limit);
  if (!records.length) throw new Error(`no trained umas in this ${found.label}`);
  const runners = [];
  const failed = [];
  let skipped = 0;
  records.forEach((record, i) => {
    try {
      const result = found.convert(record);
      runners.push(result.runner);
      skipped += result.skipped.length;
    } catch (error) {
      failed.push(records.length > 1 ? `uma ${i + 1}: ${error.message}` : error.message);
    }
  });
  // One uma this site can't use (e.g. a character it doesn't know yet) shouldn't sink the rest.
  if (!runners.length) throw new Error(failed[0]);
  const notes = CAVEATS[found.label] ? [CAVEATS[found.label]] : [];
  if (failed.length) notes.push(`left out ${failed.length} uma${failed.length === 1 ? '' : 's'} (${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '; …' : ''})`);
  return { runners, skipped, notes };
}
