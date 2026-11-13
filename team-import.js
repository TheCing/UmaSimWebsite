// Team files: a three-runner array, a saved team object, or a race file. Race files are captured
// client races (UmaSim's convert_race.py format) and horseACT / Trackside / UmaLauncher race dumps;
// the player's team is imported in member order, converted like any imported uma (uma-import.js).
import { loadTeam } from './compare.js';
import { isRaceDump, raceDumpPlayers, runnerFromTrainedChara } from './uma-import.js';

const CATEGORIES = { Short: 1, Mile: 2, Middle: 3, Long: 4 };

/** The race file's own course ({ surface, category }), or null when it doesn't say. */
function raceCourse(json) {
  const category = CATEGORIES[json.courseDistanceType ?? json['<CourseDistanceType>k__BackingField']];
  const surface = (json.raceCourseSet ?? json['<RaceCourseSet>k__BackingField'])?.ground;
  return category && (surface === 1 || surface === 2) ? { category, surface } : null;
}

/** Accept a three-runner array, a saved team object, or a race file. */
export function teamFromFile(json, fileStem) {
  if (isRaceDump(json)) {
    const { horses, everyone } = raceDumpPlayers(json);
    if (everyone || !horses.length) throw new Error("This race file doesn't say which team is yours");
    const course = raceCourse(json);
    return loadTeam({
      id: `${fileStem}-team${horses[0].data.team_id ?? 0}`,
      members: horses.map(({ data, runningStyleEx }) => runnerFromTrainedChara(data, course, { runningStyleEx }).runner),
    }, fileStem);
  }
  return loadTeam(json, fileStem);
}
