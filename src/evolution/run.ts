import crypto from "crypto";
import { LlmClient } from "../llm-client";
import { LLM_PARAM_ENUMS, PROFILE_PRESETS } from "./constants";
import { buildDesignDNA, tokenPatchFromDNA } from "./dna";
import { buildGenreBoard } from "./genre-board";
import {
  generateParamSets,
  getNormalizedDiversityRules,
  getNormalizedMode,
  getRequestedCount,
  getVisualFamilyId,
  normalizeFocusFamilies
} from "./params";
import { applyLlmAestheticScores, diverseTopK, scoreCandidate, withDiversityBonus, withExploitationBoost } from "./scoring";
import type { Candidate, EvolutionJob, EvolutionResult } from "./types";

export async function runEvolution(job: EvolutionJob): Promise<EvolutionResult> {
  const mode = getNormalizedMode(job.config);
  const focusFamilies = normalizeFocusFamilies(job.config.focusFamilies);
  const count = getRequestedCount(job.config);
  const diversityRules = getNormalizedDiversityRules(job.config.diversityRules, count, mode);

  const llmClient = new LlmClient({
    provider: job.config.llmProvider || (process.env.LLM_PROVIDER as "mock" | "gemini" | "nova") || "mock"
  });

  const paramsResult = await generateParamSets(job, llmClient, count, diversityRules, mode, focusFamilies);

  const allCandidates: Candidate[] = paramsResult.params.map((params, index) => {
    const designDNA = buildDesignDNA(params);
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
      designDNA,
      tokenPatch: tokenPatchFromDNA(designDNA),
      scores: scoreCandidate({ designDNA }),
      artifactPaths: {
        screenshot: `/artifacts/${job.jobId}/1/${index + 1}.png`,
        qaReport: `/artifacts/${job.jobId}/1/${index + 1}.qa.json`
      }
    };
  });

  const diversified = withDiversityBonus(allCandidates);
  const phaseWeighted = withExploitationBoost(diversified, focusFamilies, mode);
  const topCandidates = diverseTopK(phaseWeighted, 5).map((candidate, rank) => ({
    ...candidate,
    rank: rank + 1
  }));

  const maybeRescored = job.config.useLLMAesthetic
    ? await applyLlmAestheticScores(topCandidates, llmClient)
    : topCandidates;

  const finalTop = maybeRescored.map((candidate, rank) => ({ ...candidate, rank: rank + 1 }));

  const genreBoard = buildGenreBoard(
    phaseWeighted,
    Math.max(1, Math.floor(Number(job.config.variantsPerFamily || 4)))
  );

  return {
    totalCandidates: phaseWeighted.length,
    topCandidates: finalTop,
    allCandidates: phaseWeighted,
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
