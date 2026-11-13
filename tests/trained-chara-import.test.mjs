import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Course, UmaBuilder } from '../globalsim/index.js';
import { convertTrainedChara, isTrainedChara, runnerFromTrainedChara } from '../trained-chara-import.js';

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
    outfitId: 104001,
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
  const { runner } = runnerFromTrainedChara({ ...rest, pow: power, chara_id: 1040, motivation: 5 });
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

test('convertTrainedChara takes one record or an array, and ignores other JSON', () => {
  assert.equal(convertTrainedChara(VETERAN).runners.length, 1);
  assert.equal(convertTrainedChara([VETERAN, VETERAN]).runners.length, 2);
  assert.equal(convertTrainedChara({ charaId: 1040 }), null);
  assert.equal(convertTrainedChara([]), null);
  assert.equal(isTrainedChara([VETERAN]), false);
  assert.throws(() => convertTrainedChara([VETERAN, { ...VETERAN, running_style: 9 }]), /uma 2: unknown running_style 9/);
});
