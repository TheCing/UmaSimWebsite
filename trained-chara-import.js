// Convert the game's own trained-uma records into runner JSON.
//
// Many community tools save umas exactly as the game server sends them (`trained_chara`):
// UmaExtractor / Trackside "data.json", umadump "trained_chara_data.json" and veteran.json,
// horseACT "veterans.json". Race dumps hold the same record as `race_horse_data`, which spells
// power `pow` and also carries `chara_id` and `motivation`.
//
// The record keeps every aptitude (four distances, two surfaces, four styles) while a runner
// has one of each, so the distance and surface aptitudes follow the course being raced; without
// a course the best of each is used.
import { isSkill, isUma } from './globalsim/index.js';
import { isOwnUnique } from './hakuraku-import.js';

const GRADES = { 1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S' };
const STYLES = { 1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi' };
const STYLE_APTITUDE = {
  Nige: 'proper_running_style_nige', Senkou: 'proper_running_style_senko',
  Sasi: 'proper_running_style_sashi', Oikomi: 'proper_running_style_oikomi',
};
const DISTANCES = ['proper_distance_short', 'proper_distance_mile', 'proper_distance_middle', 'proper_distance_long'];
const SURFACES = ['proper_ground_turf', 'proper_ground_dirt'];
const RUNAWAY = 202051; // with this skill a front runner races as Oonige

/** Whether `value` looks like a game trained_chara / race_horse_data record. */
export function isTrainedChara(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.card_id) && typeof value.wiz === 'number' && Array.isArray(value.skill_array);
}

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

/**
 * Runner JSON (plus `outfitId`, the costume) for one trained_chara or race_horse_data record.
 * `course` ({ surface, category }) picks the distance and surface aptitudes. Skills the catalog
 * doesn't know are left out and listed in `skipped`.
 */
export function runnerFromTrainedChara(raw, course = null) {
  if (!isTrainedChara(raw)) throw new Error('not a trained uma record');
  const charaId = Number.isInteger(raw.chara_id) ? raw.chara_id : Math.floor(raw.card_id / 100);
  if (!isUma(charaId)) throw new Error(`unknown character ${charaId} (card ${raw.card_id})`);
  let strategy = STYLES[raw.running_style];
  if (!strategy) throw new Error(`unknown running_style ${raw.running_style}`);
  const skillIds = raw.skill_array.map((s) => Number(s?.skill_id));
  const strategyAptitude = grade(raw, STYLE_APTITUDE[strategy]);
  if (strategy === 'Nige' && skillIds.includes(RUNAWAY)) strategy = 'Oonige';

  const skills = [];
  const skipped = [];
  for (const { skill_id: id, level } of raw.skill_array) {
    if (!isSkill(Number(id))) { skipped.push(id); continue; }
    skills.push({ skillId: String(id), level: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1, isUnique: isOwnUnique(Number(id)) });
  }

  const runner = {
    charaId,
    speed: raw.speed, stamina: raw.stamina, power: raw.power ?? raw.pow, guts: raw.guts, wisdom: raw.wiz,
    strategy,
    distanceAptitude: grade(raw, pick(raw, DISTANCES, course ? course.category - 1 : -1)),
    surfaceAptitude: grade(raw, pick(raw, SURFACES, course ? course.surface - 1 : -1)),
    strategyAptitude,
    skills,
    outfitId: raw.card_id,
  };
  // Race dumps carry the mood the uma raced with (motivation 1-5).
  if (Number.isInteger(raw.motivation) && raw.motivation >= 1 && raw.motivation <= 5) runner.mood = raw.motivation - 3;
  return { runner, skipped };
}

/**
 * If `json` is a trained_chara record or an array of them, the converted runners and how many
 * unknown skills were dropped ({ runners, skipped }); otherwise null.
 */
export function convertTrainedChara(json, course = null) {
  const records = Array.isArray(json) ? json : [json];
  if (!records.length || !records.every(isTrainedChara)) return null;
  const runners = [];
  let skipped = 0;
  records.forEach((record, i) => {
    try {
      const result = runnerFromTrainedChara(record, course);
      runners.push(result.runner);
      skipped += result.skipped.length;
    } catch (error) {
      throw new Error(records.length > 1 ? `uma ${i + 1}: ${error.message}` : error.message);
    }
  });
  return { runners, skipped };
}
