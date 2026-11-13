// Turn umas saved by other Uma Musume tools into runner JSON.
//
// Sources (see recognise() for how each is recognised):
// - The game's own trained-uma record (`trained_chara`): UmaExtractor / Trackside "data.json",
//   umadump "trained_chara_data.json" and veteran.json, horseACT "veterans.json", and the game's
//   account load response. Race dumps hold the same record as `race_horse_data` (power spelled
//   `pow`, plus `chara_id` and the race's `motivation`), and career packets as `chara_info`
//   (style in `race_running_style`).
// - Race dumps: Trackside CM dumps (`race_horse_data_array`), and horseACT / Trackside /
//   UmaLauncher race files (`<RaceHorse>k__BackingField`, or plain `raceHorse`): the player's umas.
// - UmaLauncher training logs: game packets written one after another (not one JSON value);
//   the last `chara_info` is the finished uma.
// - UmaLauncher account exports (`raised_characters`): no skill ids, so only the unique is added.
// - Trackside Dashboard Team Trials history (JSON Lines): no aptitudes, so the costume's
//   defaults are used.
// - Moomoolator (uma-tools) uma JSON: runner JSON keyed by `outfitId` instead of `charaId`.
//
// A runner has one distance and one surface aptitude, but these sources know all of them. The
// whole table is kept in `allAptitudes` (10 letters: Sprint Mile Medium Long | Front Pace Late
// End | Turf Dirt, the layout of outfits.js), and aptitudesForCourse() picks the ones for the race
// being run, so a saved uma stays right when the race changes.
import { isSkill, isUma } from './globalsim/index.js';
import { OUTFITS } from './outfits.js';
import { isOwnUnique, uniqueForOutfit } from './uma-ids.js';

const GRADES = { 1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S' };
const STYLES = { 1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi' };
const STRATEGY_ORDER = ['Nige', 'Senkou', 'Sasi', 'Oikomi'];
// The game's aptitude fields in allAptitudes order.
const APTITUDE_FIELDS = [
  'proper_distance_short', 'proper_distance_mile', 'proper_distance_middle', 'proper_distance_long',
  'proper_running_style_nige', 'proper_running_style_senko', 'proper_running_style_sashi', 'proper_running_style_oikomi',
  'proper_ground_turf', 'proper_ground_dirt',
];
const RUNAWAY = 202051; // with this skill a front runner races as Oonige
const RANKS = 'GFEDCBAS';
const TABLE = /^[SABCDEFG]{10}$/;
const LETTER_STYLES = { // UmaLauncher labels and Trackside's upper-case names
  runner: 'Nige', leader: 'Senkou', betweener: 'Sasi', chaser: 'Oikomi',
  nige: 'Nige', senko: 'Senkou', senkou: 'Senkou', sashi: 'Sasi', sasi: 'Sasi', oikomi: 'Oikomi',
  oonige: 'Oonige', runaway: 'Oonige',
};
// Uniques are usually one level above the uma's stars; files without stars get the 3★ level.
const DEFAULT_UNIQUE_LEVEL = 4;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Parse an uploaded file's text: one JSON value, JSON objects written one after another with
 * commas between them (UmaLauncher training logs), or JSON Lines (a last line cut off mid-write
 * is ignored). Throws the JSON error otherwise.
 */
export function parseUmaText(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    try { return JSON.parse(`[${text}]`); } catch { /* not comma-separated objects */ }
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > 1) {
      const parsed = [];
      for (const [i, line] of lines.entries()) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          if (i < lines.length - 1) throw error;
        }
      }
      return parsed;
    }
    throw error;
  }
}

// ---- aptitudes ------------------------------------------------------------------------------

const strategyIndex = (strategy) => 4 + STRATEGY_ORDER.indexOf(strategy === 'Oonige' ? 'Nige' : strategy);
const best = (letters) => [...letters].sort((a, b) => RANKS.indexOf(b) - RANKS.indexOf(a))[0];

/** distanceAptitude / surfaceAptitude / strategyAptitude from a 10-letter table for a course. */
function fromTable(table, strategy, course) {
  return {
    distanceAptitude: course ? table[course.category - 1] : best(table.slice(0, 4)),
    surfaceAptitude: course ? table[8 + course.surface - 1] : best(table.slice(8, 10)),
    strategyAptitude: table[strategyIndex(strategy)],
  };
}

/** The style aptitude for `strategy` in a 10-letter aptitude table (null if it isn't one). */
export function styleAptitude(table, strategy) {
  return TABLE.test(table ?? '') && STRATEGY_ORDER.includes(strategy === 'Oonige' ? 'Nige' : strategy)
    ? table[strategyIndex(strategy)] : null;
}

/**
 * The runner with its distance, surface and style aptitudes taken from its `allAptitudes` table
 * for `course` ({ surface, category }). Runners without a table are returned unchanged.
 */
export function aptitudesForCourse(runner, course) {
  if (!course || !isObject(runner) || !TABLE.test(runner.allAptitudes ?? '')) return runner;
  return { ...runner, ...fromTable(runner.allAptitudes, runner.strategy, course) };
}

// ---- game records ---------------------------------------------------------------------------

/** Whether `value` looks like a game trained_chara / race_horse_data / chara_info record. */
export function isTrainedChara(value) {
  return isObject(value) && Number.isInteger(value.card_id) && typeof value.wiz === 'number'
    && Array.isArray(value.skill_array);
}

/** A trained uma rather than an NPC (race dumps include mobs with no card). */
const isTrainedUma = (value) => isTrainedChara(value) && value.card_id > 0 && !(value.mob_id > 0);

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

/** The outfit's own unique (3★ costumes) as a runner skill, or null if the catalog lacks it. */
function ownUnique(cardId, level) {
  const id = Number(uniqueForOutfit(cardId));
  return isSkill(id) ? { skillId: String(id), level: Math.min(6, Math.max(1, level)), isUnique: true } : null;
}

/**
 * Runner JSON (plus `outfitId`, the costume, and `allAptitudes`) for one trained_chara,
 * race_horse_data or chara_info record. `course` ({ surface, category }) picks the distance and
 * surface aptitudes; `runningStyleEx` is a race dump's extended style ('Oonige' / 'Runaway' make
 * it Oonige); `withMood` takes the race's mood from `motivation` (race dumps only: elsewhere it
 * is the mood at the end of a career, not a race's). Unknown skills are listed in `skipped`.
 */
export function runnerFromTrainedChara(raw, course = null, { runningStyleEx = null, withMood = false } = {}) {
  if (!isTrainedChara(raw)) throw new Error('not a trained uma record');
  const charaId = Number.isInteger(raw.chara_id) && raw.chara_id < 10000 ? raw.chara_id : Math.floor(raw.card_id / 100);
  requireUma(charaId, raw.card_id);
  const style = raw.running_style ?? raw.race_running_style;
  let strategy = STYLES[style];
  if (!strategy) throw new Error(`unknown running_style ${style}`);
  const allAptitudes = APTITUDE_FIELDS.map((field) => {
    const letter = GRADES[raw[field]];
    if (!letter) throw new Error(`invalid aptitude ${field}: ${raw[field]}`);
    return letter;
  }).join('');
  const ex = String(runningStyleEx ?? '').toLowerCase();
  if (strategy === 'Nige' && (ex === 'oonige' || ex === 'runaway' || raw.skill_array.some((s) => Number(s?.skill_id) === RUNAWAY))) {
    strategy = 'Oonige';
  }
  const skipped = [];
  const runner = {
    charaId,
    speed: raw.speed, stamina: raw.stamina, power: raw.power ?? raw.pow, guts: raw.guts, wisdom: raw.wiz,
    strategy,
    ...fromTable(allAptitudes, strategy, course),
    skills: skillsFrom(raw.skill_array.map((s) => [s?.skill_id, s?.level]), skipped),
    outfitId: raw.card_id,
    allAptitudes,
  };
  if (withMood && Number.isInteger(raw.motivation) && raw.motivation >= 1 && raw.motivation <= 5) runner.mood = raw.motivation - 3;
  return { runner, skipped };
}

// ---- other tools' shapes --------------------------------------------------------------------

/** The costume's default aptitude letters, in allAptitudes order. */
function outfitAptitudes(charaId, cardId) {
  const outfits = OUTFITS[charaId] ?? [];
  return (outfits.find((o) => o.id === cardId) ?? outfits[0])?.aptitudes ?? null;
}

/** UmaLauncher account export entry: letter aptitudes, no skill ids (only the unique is added). */
function runnerFromAccountEntry(entry, course) {
  const charaId = Math.floor(entry.card_id / 100);
  requireUma(charaId, entry.card_id);
  const strategy = LETTER_STYLES[String(entry.running_style).toLowerCase()];
  if (!strategy) throw new Error(`unknown running_style ${entry.running_style}`);
  const apt = entry.aptitudes ?? {};
  const allAptitudes = ['short', 'mile', 'middle', 'long', 'runner', 'leader', 'betweener', 'chaser', 'turf', 'dirt']
    .map((key) => apt[key] ?? '').join('');
  if (!TABLE.test(allAptitudes)) throw new Error('missing aptitudes');
  const level = Number.isInteger(entry.rarity) ? entry.rarity + 1 : DEFAULT_UNIQUE_LEVEL;
  const unique = ownUnique(entry.card_id, level);
  const runner = {
    charaId,
    speed: entry.stats?.speed, stamina: entry.stats?.stamina, power: entry.stats?.power,
    guts: entry.stats?.guts, wisdom: entry.stats?.wisdom ?? entry.stats?.wiz,
    strategy,
    ...fromTable(allAptitudes, strategy, course),
    skills: unique ? [unique] : [],
    outfitId: entry.card_id,
    allAptitudes,
  };
  return { runner, skipped: [] };
}

/** Trackside Dashboard Team Trials row: no aptitudes (costume defaults) and no skill levels. */
function runnerFromTeamTrialsRow(row, course) {
  const cardId = row.chara_id > 9999 ? row.chara_id : row.card_id;
  const charaId = Math.floor(cardId / 100);
  requireUma(charaId, cardId);
  let strategy = LETTER_STYLES[String(row.running_style).toLowerCase()];
  if (!strategy) throw new Error(`unknown running_style ${row.running_style}`);
  const allAptitudes = outfitAptitudes(charaId, cardId);
  if (!allAptitudes) throw new Error(`no default aptitudes for character ${charaId}`);
  const ids = row.owned_skills ?? [];
  if (strategy === 'Nige' && ids.map(Number).includes(RUNAWAY)) strategy = 'Oonige';
  const skipped = [];
  const skills = skillsFrom(ids.map((id) => [id, 1]), skipped)
    .map((s) => (s.isUnique ? { ...s, level: DEFAULT_UNIQUE_LEVEL } : s));
  const runner = {
    charaId,
    speed: row.stats.speed, stamina: row.stats.stamina, power: row.stats.power ?? row.stats.pow,
    guts: row.stats.guts, wisdom: row.stats.wiz ?? row.stats.wisdom,
    strategy,
    ...fromTable(allAptitudes, strategy, course),
    skills,
    outfitId: cardId,
    allAptitudes,
  };
  return { runner, skipped };
}

/** Moomoolator uma JSON: `outfitId` instead of `charaId`, the unique's level in `uniqueLv`. */
function runnerFromMoomoolator(data) {
  const cardId = Number(data.outfitId);
  const charaId = Math.floor(cardId / 100);
  requireUma(charaId, cardId);
  const { outfitId, starCount, uniqueLv, forcedSkillPositions, skills: ids = [], ...rest } = data;
  const level = Number.isInteger(uniqueLv) ? uniqueLv : 1;
  const unique = ownUnique(cardId, level);
  const pairs = ids.map((id) => [isObject(id) ? id.skillId : id, null]);
  if (unique && !pairs.some(([id]) => id != null && String(Number(id)) === unique.skillId)) pairs.unshift([unique.skillId, null]);
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

/** Whether `json` is a horseACT / Trackside / UmaLauncher race dump or a captured client race. */
export const isRaceDump = (json) => Array.isArray(raceHorsesOf(json));

/**
 * The player's horses in a race dump as { data (race_horse_data), runningStyleEx }, in team
 * order. Some races list NPCs as the "team"; then the player's own horse is used, and failing
 * that every trained uma (`everyone: true`).
 */
export function raceDumpPlayers(json) {
  const horses = raceHorsesOf(json) ?? [];
  const team = json['<PlayerTeamMemberArray>k__BackingField'] ?? json.playerTeamMemberArray;
  const index = json._playerHorseIndex ?? json.playerHorseIndex;
  const trained = (list) => list
    .map((horse) => ({ data: horse?._responseHorseData ?? horse?.responseHorseData, runningStyleEx: horse?._runningStyleEx ?? horse?.runningStyleEx }))
    .filter(({ data }) => isTrainedUma(data));
  // A team is the horses sharing the first member's team_id, in team_member_id order.
  const teamId = trained(Array.isArray(team) ? team : [])[0]?.data.team_id;
  const ofTeam = teamId == null ? [] : trained(horses).filter(({ data }) => data.team_id === teamId)
    .sort((a, b) => (a.data.team_member_id ?? 0) - (b.data.team_member_id ?? 0));
  const own = Number.isInteger(index) && horses[index] ? trained([horses[index]]) : [];
  if (ofTeam.length) return { horses: ofTeam, everyone: false };
  if (own.length) return { horses: own, everyone: false };
  return { horses: trained(horses), everyone: true };
}

const EVERYONE = 'this file doesn\'t say which umas are yours, so every runner in the race was included';

/**
 * Work out which tool `json` came from. Returns the uma records, how to convert each and what the
 * source leaves out ({ label, records, convert, notes }), or null for JSON that isn't one of these.
 */
function recognise(json, course) {
  const fromGame = (record) => runnerFromTrainedChara(record, course);
  const fromRace = (record) => runnerFromTrainedChara(record, course, { withMood: true });
  if (Array.isArray(json)) {
    if (json.length && json.every(isTrainedChara)) return { label: 'game records', records: json.filter(isTrainedUma), convert: fromGame };
    if (json.length && json.every(isTeamTrialsRow)) {
      // One row per race: keep the latest row of each uma (trained_chara_id is only unique per card).
      const byUma = new Map(json.map((row) => [`${row.chara_id}:${row.card_id}:${row.trained_chara_id ?? JSON.stringify(row.stats)}`, row]));
      return {
        label: 'Team Trials history', records: [...byUma.values()], convert: (row) => runnerFromTeamTrialsRow(row, course),
        notes: [`Team Trials history has no aptitudes or skill levels, so each costume's default aptitudes and a Lv ${DEFAULT_UNIQUE_LEVEL} unique were used`],
      };
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
    return { label: 'race dump', records: json.race_horse_data_array.filter(isTrainedUma), convert: fromRace, notes: [EVERYONE] };
  }
  if (isRaceDump(json)) {
    const { horses, everyone } = raceDumpPlayers(json);
    return {
      label: 'race dump', records: horses, notes: everyone ? [EVERYONE] : [],
      convert: ({ data, runningStyleEx }) => runnerFromTrainedChara(data, course, { runningStyleEx, withMood: true }),
    };
  }
  if (isAccountExport(json)) {
    return {
      label: 'account export', records: json.raised_characters, convert: (e) => runnerFromAccountEntry(e, course),
      notes: ['UmaLauncher account exports have no skill list, so only each uma\'s unique was added (its level estimated from the uma\'s stars)'],
    };
  }
  if (isTeamTrialsRow(json)) return recognise([json], course);
  if (isMoomoolator(json)) return { label: 'Moomoolator', records: [json], convert: runnerFromMoomoolator };
  return null;
}

/**
 * If `json` comes from one of the tools above, the converted runners and what to tell the user
 * ({ runners, skipped: number of unknown skills dropped, notes: [string] }); otherwise null.
 * `limit` stops after that many converted umas (the editor needs one). An uma that can't be
 * converted is left out with a note, unless none can be.
 */
export function convertUmaJson(json, course = null, { limit = Infinity } = {}) {
  const found = recognise(json, course);
  if (!found) return null;
  const { records } = found;
  if (!records.length) throw new Error(`no trained umas in this ${found.label}`);
  const runners = [];
  const failed = [];
  let skipped = 0;
  for (const [i, record] of records.entries()) {
    if (runners.length >= limit) break;
    try {
      const result = found.convert(record);
      runners.push(result.runner);
      skipped += result.skipped.length;
    } catch (error) {
      failed.push(records.length > 1 ? `uma ${i + 1}: ${error.message}` : error.message);
    }
  }
  if (!runners.length) throw new Error(failed[0]);
  const notes = [...(found.notes ?? [])];
  if (failed.length) notes.push(`left out ${failed.length} uma${failed.length === 1 ? '' : 's'} (${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '; …' : ''})`);
  return { runners, skipped, notes };
}
