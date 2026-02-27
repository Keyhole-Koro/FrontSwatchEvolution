import type { Candidate } from "./types";
import { toTitleCase } from "./utils";

export function buildGenreBoard(candidates: Candidate[], variantsPerFamily = 6) {
  const groups = new Map<string, Candidate[]>();

  for (const candidate of candidates) {
    const list = groups.get(candidate.visualFamilyId) || [];
    list.push(candidate);
    groups.set(candidate.visualFamilyId, list);
  }

  return Array.from(groups.entries())
    .map(([familyId, group]) => {
      const sorted = [...group].sort((a, b) => b.scores.score - a.scores.score).slice(0, variantsPerFamily);
      const [vibe, era] = familyId.split("/");
      return {
        familyId,
        label: `${toTitleCase(vibe)} ${toTitleCase(era)}`,
        candidates: sorted
      };
    })
    .sort((a, b) => b.candidates[0].scores.score - a.candidates[0].scores.score);
}
