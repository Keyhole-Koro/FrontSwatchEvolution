import crypto from "crypto";
import { LlmClient } from "../llm-client";
import { LLM_PARAM_ENUMS, PROFILE_PRESETS } from "./constants";
import { buildGenreBoard } from "./genre-board";
import { attachArtifacts } from "./artifacts";
import {
  generateParamSets,
  getNormalizedDiversityRules,
  getNormalizedMode,
  getRequestedCount,
  getVisualFamilyId,
  normalizeFocusFamilies
} from "./params";
import { applyLlmAestheticScores } from "./scoring";
import type { Candidate, EvolutionJob, EvolutionResult } from "./types";

export async function runEvolution(job: EvolutionJob): Promise<EvolutionResult> {
  const mode = getNormalizedMode(job.config);
  const focusFamilies = normalizeFocusFamilies(job.config.focusFamilies);
  const count = getRequestedCount(job.config);
  const diversityRules = getNormalizedDiversityRules(job.config.diversityRules, count, mode);

  const llmClient = new LlmClient({
    provider: job.config.llmProvider || (process.env.LLM_PROVIDER as "gemini" | "nova")
  });

  const paramsResult = await generateParamSets(job, llmClient, count, diversityRules, mode, focusFamilies);

  const allCandidates: Candidate[] = paramsResult.params.map((params, index) => {
    const visualFamilyId = getVisualFamilyId(params);
    return {
      candidateId: `cand_${String(index + 1).padStart(4, "0")}_${crypto.randomUUID().slice(0, 6)}`,
      generation: 1,
      params,
      visualFamilyId,
      genre: {
        id: visualFamilyId,
        mood: params.vibe,
        domain: "generated",
        density: PROFILE_PRESETS.densityProfile[params.densityProfile as keyof typeof PROFILE_PRESETS.densityProfile].density
      },
      designDNA: {
        params,
        resolvedProfiles: { typeProfile: "humanist" },
        palette: { hueShift: 0, saturationScale: 1, lightnessBias: 0 },
        typography: { scale: 1, weightBias: 0 },
        surfaces: { radiusScale: 1, radiusBase: 12, shadowDepth: 2, shadowOpacity: 0.12 },
        spacing: { scale: 1, density: 0.8 }
      },
      tokenPatch: {},
      scores: {
        readability: 0,
        layoutSafety: 0,
        brandConsistency: 0,
        aesthetics: 0,
        diversityBonus: 0,
        score: 0
      },
      artifactPaths: {
        screenshot: "",
        qaReport: "",
        sourceReactTsx: ""
      }
    };
  });

  const candidatesWithArtifacts = await attachArtifacts(job.jobId, allCandidates, llmClient);
  const llmScored = await applyLlmAestheticScores(candidatesWithArtifacts, llmClient);
  const sorted = [...llmScored].sort((a, b) => b.scores.score - a.scores.score);
  const topCandidates = sorted.slice(0, 5).map((candidate, rank) => ({
    ...candidate,
    rank: rank + 1
  }));

  const genreBoard = buildGenreBoard(
    sorted,
    Math.max(1, Math.floor(Number(job.config.variantsPerFamily || 4)))
  );

  return {
    totalCandidates: sorted.length,
    topCandidates,
    allCandidates: sorted,
    genreBoard,
    llm: llmClient.getProviderInfo(),
    paramGeneration: {
      count,
      mode,
      enums: LLM_PARAM_ENUMS,
      diversityRules,
      validation: paramsResult.validation
    }
  };
}
