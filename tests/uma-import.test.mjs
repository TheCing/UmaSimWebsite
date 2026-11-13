import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Course, UmaBuilder } from '../globalsim/index.js';
import { aptitudesForCourse, convertUmaJson, isTrainedChara, parseUmaText, runnerFromTrainedChara } from '../uma-import.js';
import { teamFromFile } from '../team-import.js';

// A veteran as the game server sends it (trimmed; no account fields).
const VETERAN = {
  card_id: 104001, speed: 1200, stamina: 567, power: 899, wiz: 1126, guts: 434,
  proper_ground_turf: 7, proper_ground_dirt: 3,
  proper_distance_short: 2, proper_distance_mile: 8, proper_distance_middle: 6, proper_distance_long: 4,
  proper_running_style_nige: 4, proper_running_style_senko: 7, proper_running_style_sashi: 6, proper_running_style_oikomi: 1,
  running_style: 2,
  skill_array: [{ skill_id: 100401, level: 5 }, { skill_id: 200332, level: 1 }],
};
const course = (surface, category) => Course.all().find((c) => c.surface === surface && c.category === category);

test('a veteran converts to runner JSON the engine accepts', () => {
  const { runner, skipped } = runnerFromTrainedChara(VETERAN, course(1, 2));
  assert.deepEqual(skipped, []);
  assert.deepEqual(runner, {
    charaId: 1040, speed: 1200, stamina: 567, power: 899, guts: 434, wisdom: 1126,
    strategy: 'Senkou', distanceAptitude: 'S', surfaceAptitude: 'A', strategyAptitude: 'A',
    skills: [{ skillId: '100401', level: 5, isUnique: true }, { skillId: '200332', level: 1, isUnique: false }],
    outfitId: 104001, allAptitudes: 'FSBDDABGAE',
  });
  UmaBuilder.fromJson(runner);
});

test('distance and surface aptitudes follow the course, or the best one without a course', () => {
  const dirtLong = runnerFromTrainedChara(VETERAN, course(2, 4)).runner;
  assert.equal(dirtLong.distanceAptitude, 'D');
  assert.equal(dirtLong.surfaceAptitude, 'E');
  const none = runnerFromTrainedChara(VETERAN).runner;
  assert.equal(none.distanceAptitude, 'S');
  assert.equal(none.surfaceAptitude, 'A');
});

test('a front runner with Runaway is Oonige, rated with the front-runner aptitude', () => {
  const raw = { ...VETERAN, running_style: 1, skill_array: [...VETERAN.skill_array, { skill_id: 202051, level: 1 }] };
  const { runner } = runnerFromTrainedChara(raw);
  assert.equal(runner.strategy, 'Oonige');
  assert.equal(runner.strategyAptitude, 'D');
});

test('race dumps: pow, chara_id and motivation', () => {
  const { power, ...rest } = VETERAN;
  const { runner } = runnerFromTrainedChara({ ...rest, pow: power, chara_id: 1040, motivation: 5 }, null, { withMood: true });
  assert.equal(runner.power, 899);
  assert.equal(runner.charaId, 1040);
  assert.equal(runner.mood, 2);
});

test('unknown skills are dropped and reported', () => {
  const raw = { ...VETERAN, skill_array: [...VETERAN.skill_array, { skill_id: 999999, level: 1 }] };
  const { runner, skipped } = runnerFromTrainedChara(raw);
  assert.deepEqual(skipped, [999999]);
  assert.equal(runner.skills.length, 2);
});

test('game records: one, an array, or the account load response; other JSON is not recognised', () => {
  assert.equal(convertUmaJson(VETERAN).runners.length, 1);
  assert.equal(convertUmaJson([VETERAN, VETERAN]).runners.length, 2);
  assert.equal(convertUmaJson({ trained_chara: [VETERAN, VETERAN] }).runners.length, 2);
  assert.equal(convertUmaJson({ charaId: 1040 }), null);
  assert.equal(convertUmaJson([]), null);
  assert.equal(isTrainedChara([VETERAN]), false);
});

test('an uma that cannot be converted is left out with a note, unless it is the only one', () => {
  const result = convertUmaJson([VETERAN, { ...VETERAN, card_id: 999901 }]);
  assert.equal(result.runners.length, 1);
  assert.match(result.notes[0], /left out 1 uma \(uma 2: unknown character 9999/);
  assert.throws(() => convertUmaJson({ ...VETERAN, running_style: 9 }), /unknown running_style 9/);
});

test('race dumps: the player team, NPCs skipped, the extended style kept', () => {
  const { power, ...rest } = VETERAN;
  const horse = (data, ex = 'None') => ({ _responseHorseData: data, _runningStyleEx: ex });
  const mob = { ...rest, pow: power, card_id: 0, mob_id: 8145 };
  const nige = { ...rest, pow: power, chara_id: 1040, running_style: 1, motivation: 3 };
  const dump = {
    '<RaceHorse>k__BackingField': [horse(mob), horse(nige, 'Oonige'), horse({ ...nige, card_id: 105601, chara_id: 1056 })],
    '<PlayerTeamMemberArray>k__BackingField': [horse(mob)], // NPC "team": falls back to the player's horse
    _playerHorseIndex: 1,
  };
  const { runners } = convertUmaJson(dump);
  assert.equal(runners.length, 1);
  assert.equal(runners[0].strategy, 'Oonige');
  assert.equal(runners[0].mood, 0);
  assert.equal(convertUmaJson({ race_horse_data_array: [mob, nige, nige] }).runners.length, 2);
  assert.equal(convertUmaJson({ raceHorse: [{ responseHorseData: nige }] }).runners.length, 1);
});

test('UmaLauncher training log: comma-separated packets, the last chara_info wins', () => {
  const { running_style: _, ...info } = VETERAN;
  const text = [
    { event_id: 3000, steam_session_ticket: 'x' },
    { chara_info: { ...info, race_running_style: 2, speed: 100, motivation: 3 } },
    { chara_info: { ...info, race_running_style: 2, speed: 1200, motivation: 5 } },
    { home_info: {} },
  ].map((o) => JSON.stringify(o)).join(',');
  assert.throws(() => JSON.parse(text));
  const { runners } = convertUmaJson(parseUmaText(text));
  assert.equal(runners.length, 1);
  assert.equal(runners[0].speed, 1200);
  assert.equal(runners[0].mood, undefined); // a career's last mood isn't a race mood
  UmaBuilder.fromJson(runners[0]);
});

test('UmaLauncher account export: letter aptitudes, only the unique as a skill', () => {
  const entry = {
    card_id: 104001, stats: { speed: 1100, stamina: 700, power: 800, guts: 400, wisdom: 900 },
    running_style: 'Leader', talent_level: 4, rarity: 4,
    aptitudes: { turf: 'A', dirt: 'E', short: 'F', mile: 'S', middle: 'B', long: 'D', runner: 'D', leader: 'A', betweener: 'B', chaser: 'G' },
  };
  const result = convertUmaJson({ exported_at: 'x', raised_characters: [entry] }, course(2, 4));
  const [runner] = result.runners;
  assert.equal(runner.strategy, 'Senkou');
  assert.deepEqual([runner.distanceAptitude, runner.surfaceAptitude, runner.strategyAptitude], ['D', 'E', 'A']);
  assert.deepEqual(runner.skills, [{ skillId: '100401', level: 5, isUnique: true }]); // 4 stars -> Lv 5
  assert.match(result.notes[0], /no skill list/);
  UmaBuilder.fromJson(runner);
});

test('Trackside Team Trials history (JSON Lines): costume aptitudes, one uma per trained_chara_id', () => {
  const row = (race_idx, speed) => JSON.stringify({
    trial_id: 'tt_1', race_idx, trained_chara_id: 7, chara_id: 104001,
    stats: { speed, stamina: 600, power: 800, guts: 400, wiz: 1000 }, running_style: 'SENKO', owned_skills: [100401, 200332],
  });
  const result = convertUmaJson(parseUmaText(`${row(0, 1100)}\n${row(1, 1150)}\n`), course(1, 2));
  assert.equal(result.runners.length, 1);
  const [runner] = result.runners;
  assert.equal(runner.speed, 1150);
  assert.equal(runner.wisdom, 1000);
  assert.equal(runner.strategy, 'Senkou');
  assert.match(result.notes[0], /default aptitudes/);
  assert.deepEqual(runner.skills.map((s) => [s.isUnique, s.level]), [[true, 4], [false, 1]]);
  UmaBuilder.fromJson(runner);
});

test('Moomoolator uma JSON: outfitId becomes charaId, the unique gets uniqueLv', () => {
  const moo = {
    outfitId: '104001', starCount: 3, uniqueLv: 5, speed: 1200, stamina: 600, power: 900, guts: 400, wisdom: 1100,
    strategy: 'Sasi', distanceAptitude: 'A', surfaceAptitude: 'A', strategyAptitude: 'A', mood: 2,
    skills: ['200332'], forcedSkillPositions: {},
  };
  const [runner] = convertUmaJson(moo).runners;
  assert.deepEqual(runner, {
    speed: 1200, stamina: 600, power: 900, guts: 400, wisdom: 1100, strategy: 'Sasi',
    distanceAptitude: 'A', surfaceAptitude: 'A', strategyAptitude: 'A', mood: 2, charaId: 1040,
    skills: [{ skillId: '100401', level: 5, isUnique: true }, { skillId: '200332', level: 1, isUnique: false }],
    outfitId: 104001,
  });
});

test('parseUmaText: plain JSON, JSON Lines, and the original error for anything else', () => {
  assert.deepEqual(parseUmaText('{"a":1}'), { a: 1 });
  assert.deepEqual(parseUmaText('{"a":1}\n{"a":2}'), [{ a: 1 }, { a: 2 }]);
  assert.throws(() => parseUmaText('not json'), SyntaxError);
});

test('the aptitude table follows the race; runners without one are left alone', () => {
  const { runner } = runnerFromTrainedChara(VETERAN, course(1, 2));
  const dirtLong = aptitudesForCourse({ ...runner, strategy: 'Sasi' }, course(2, 4));
  assert.deepEqual([dirtLong.distanceAptitude, dirtLong.surfaceAptitude, dirtLong.strategyAptitude], ['D', 'E', 'B']);
  const plain = { charaId: 1040, distanceAptitude: 'A' };
  assert.equal(aptitudesForCourse(plain, course(2, 4)), plain);
});

test('limit counts converted umas: an unusable first uma does not stop the editor import', () => {
  const result = convertUmaJson([{ ...VETERAN, card_id: 999901 }, VETERAN, VETERAN], null, { limit: 1 });
  assert.equal(result.runners.length, 1);
  assert.equal(result.runners[0].charaId, 1040);
});

test('CM dumps say that every runner was included', () => {
  const { notes } = convertUmaJson({ race_horse_data_array: [VETERAN] });
  assert.match(notes[0], /every runner/);
});

test('Team Trials rows of different umas sharing a trained_chara_id stay separate', () => {
  const row = (chara_id) => ({ trial_id: 't', trained_chara_id: 7, chara_id, stats: { speed: 1, stamina: 1, power: 1, guts: 1, wiz: 1 }, running_style: 'SENKO', owned_skills: [] });
  assert.equal(convertUmaJson([row(104001), row(105601)]).runners.length, 2);
});

test('parseUmaText ignores a JSON Lines file\'s cut-off last line, but not a broken middle one', () => {
  assert.deepEqual(parseUmaText('{"a":1}\n{"a":2}\n{"a":'), [{ a: 1 }, { a: 2 }]);
  assert.throws(() => parseUmaText('{"a":1}\n{"a":\n{"a":3}'), SyntaxError);
});

test('team import reads race dumps through the same conversion, in member order', () => {
  const { power, ...rest } = VETERAN;
  const member = (card_id, team_member_id, team_id = 1) => ({
    _responseHorseData: { ...rest, pow: power, card_id, chara_id: Math.floor(card_id / 100), team_id, team_member_id },
    _runningStyleEx: 'None',
  });
  const team = [member(105601, 2), member(104001, 1), member(100101, 3)];
  const dump = {
    '<RaceHorse>k__BackingField': [...team, member(100201, 1, 2)],
    '<PlayerTeamMemberArray>k__BackingField': [team[0]],
    '<CourseDistanceType>k__BackingField': 'Long',
  };
  const loaded = teamFromFile(dump, 'race');
  assert.deepEqual(loaded.members.map((m) => m.charaId), [1040, 1056, 1001]);
  assert.equal(loaded.id, 'race-team1');
  assert.throws(() => teamFromFile({ raceHorse: [] }, 'x'), /which team is yours/);
});
