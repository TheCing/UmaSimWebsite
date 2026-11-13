// Id rules shared by the importers and the pickers: which unique skill belongs to which costume.
// Character uniques are 1 (NN-1) CCC 1, e.g. outfit 101102 -> 110111 (the rule umalator uses).
import { inheritedSkill, skillIsInherited } from './globalsim/index.js';

/** The unique skill id of an outfit. */
export function uniqueForOutfit(outfitId) {
  const s = String(outfitId);
  return String(100000 + 10000 * (Number(s.slice(-2)) - 1) + Number(s.slice(1, -2)) * 10 + 1);
}

/** The outfit a unique skill belongs to (6-digit 3★+ uniques, or the older 5-digit ones). */
export function outfitForUnique(skillId) {
  const s = String(skillId ?? '');
  if (s.length === 6 && s[0] === '1' && s[5] === '1') return 100000 + Number(s.slice(2, 5)) * 100 + Number(s[1]) + 1;
  if (s.length === 5 && s[0] === '1' && s[4] === '1') return Math.floor(Number(s) / 10) * 100 + (Number(s) % 10);
  return null;
}

/** A runner's own unique: a non-inherited skill that has an inherited version. */
export function isOwnUnique(skill) {
  if (skillIsInherited(skill)) return false;
  try {
    inheritedSkill(skill);
    return true;
  } catch {
    return false;
  }
}
