import { LlmClient } from "../llm-client";
import { clamp, rand } from "./utils";
import type { Candidate, CandidateScores, DesignDNA, EvolutionMode } from "./types";

export function scoreCandidate(candidate: { designDNA: DesignDNA }): CandidateScores {
  const params = candidate.designDNA.params;

  const readabilityBase =
    params.colorStrategy === "highContrast" ? 0.9 : params.colorStrategy === "neon" ? 0.72 : 0.82;
  const layoutSafetyBase = params.densityProfile === "compact" ? 0.78 : 0.86;
  const brandConsistencyBase = params.vibe === "minimal" || params.vibe === "premium" ? 0.88 : 0.8;
  const aestheticsBase = params.era === "y2k" || params.era === "neo-brutalist" ? 0.8 : 0.85;

  const readability = clamp(readabilityBase + rand(-0.08, 0.08), 0, 1);
  const layoutSafety = clamp(layoutSafetyBase + rand(-0.08, 0.08), 0, 1);
  const brandConsistency = clamp(brandConsistencyBase + rand(-0.09, 0.09), 0, 1);
  const aesthetics = clamp(aestheticsBase + rand(-0.09, 0.09), 0, 1);

  const score = readability * 0.25 + layoutSafety * 0.2 + brandConsistency * 0.2 + aesthetics * 0.25;

  return {
    readability,
    layoutSafety,
    brandConsistency,
    aesthetics,
    diversityBonus: 0,
    score: clamp(score, 0, 1)
  };
}

function diversityDistance(a: DesignDNA, b: DesignDNA): number {
  const hue = Math.abs(a.palette.hueShift - b.palette.hueShift) / 30;
  const sat = Math.abs(a.palette.saturationScale - b.palette.saturationScale);
  const type = Math.abs(a.typography.scale - b.typography.scale);
  const radius = Math.abs(a.surfaces.radiusScale - b.surfaces.radiusScale);
  const spacing = Math.abs(a.spacing.scale - b.spacing.scale);
  return (hue + sat + type + radius + spacing) / 5;
}

export function withDiversityBonus(candidates: Candidate[]): Candidate[] {
  return candidates.map((candidate) => {
    const nearest = candidates
      .filter((other) => other !== candidate)
      .map((other) => diversityDistance(candidate.designDNA, other.designDNA));

    const minDistance = nearest.length > 0 ? Math.min(...nearest) : 0;
    const diversityBonus = clamp(minDistance * 0.15, 0, 0.1);

    return {
      ...candidate,
      scores: {
        ...candidate.scores,
        diversityBonus,
        score: clamp(candidate.scores.score + diversityBonus, 0, 1)
      }
    };
  });
}

export function withExploitationBoost(
  candidates: Candidate[],
  focusFamilies: string[],
  mode: EvolutionMode
): Candidate[] {
  if (mode !== "exploitation" || focusFamilies.length === 0) return candidates;
  const focused = new Set(focusFamilies);
  return candidates.map((candidate) => {
    if (!focused.has(candidate.visualFamilyId)) return candidate;
    return {
      ...candidate,
      scores: {
        ...candidate.scores,
        score: clamp(candidate.scores.score + 0.06, 0, 1)
      }
    };
  });
}

export function diverseTopK(candidates: Candidate[], k: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.scores.score - a.scores.score);
  const selected: Candidate[] = [];

  for (const candidate of sorted) {
    if (selected.length >= k) break;
    if (selected.length === 0) {
      selected.push(candidate);
      continue;
    }

    const minDistance = Math.min(
      ...selected.map((picked) => diversityDistance(candidate.designDNA, picked.designDNA))
    );

    if (minDistance >= 0.12 || selected.length < 2) {
      selected.push(candidate);
    }
  }

  while (selected.length < Math.min(k, sorted.length)) {
    const next = sorted.find((item) => !selected.includes(item));
    if (!next) break;
    selected.push(next);
  }

  return selected;
}

export async function applyLlmAestheticScores(
  topCandidates: Candidate[],
  llmClient: LlmClient
): Promise<Candidate[]> {
  const rescored: Candidate[] = [];
  for (const candidate of topCandidates) {
    try {
      const llm = await llmClient.scoreAesthetic({
        candidateId: candidate.candidateId,
        designDNA: candidate.designDNA
      });
      const llmScore = clamp(Number(llm.score || candidate.scores.aesthetics), 0, 1);
      const mergedScore =
        candidate.scores.readability * 0.25 +
        candidate.scores.layoutSafety * 0.2 +
        candidate.scores.brandConsistency * 0.2 +
        llmScore * 0.25 +
        candidate.scores.diversityBonus;

      rescored.push({
        ...candidate,
        scores: {
          ...candidate.scores,
          aesthetics: llmScore,
          score: clamp(mergedScore, 0, 1)
        },
        llmAesthetic: {
          provider: llmClient.getProviderInfo().provider,
          reason: llm.reason || null,
          riskFlags: llm.riskFlags || []
        }
      });
    } catch {
      rescored.push(candidate);
    }
  }
  return rescored.sort((a, b) => b.scores.score - a.scores.score);
}
