import { LlmClient } from "../llm-client";
import { DEFAULT_DIVERSITY_RULES, LLM_PARAM_ENUMS } from "./constants";
import { clamp } from "./utils";
import type { DiversityRules, EvolutionJob, EvolutionMode, GenerationConfig, ParamValidation, Params } from "./types";

export function getVisualFamilyId(params: Params): string {
  return `${params.vibe}/${params.era}`;
}

function stableSignature(params: Params): string {
  return [
    params.vibe,
    params.era,
    params.densityProfile,
    params.elevationProfile,
    params.radiusProfile,
    params.colorStrategy
  ].join("|");
}

function normalizeCandidate(raw: unknown): Params | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const params =
    record.params && typeof record.params === "object"
      ? (record.params as Record<string, unknown>)
      : record;

  return {
    vibe: String(params.vibe || ""),
    era: String(params.era || ""),
    densityProfile: String(params.densityProfile || ""),
    elevationProfile: String(params.elevationProfile || ""),
    radiusProfile: String(params.radiusProfile || ""),
    colorStrategy: String(params.colorStrategy || "")
  };
}

function validateParamsSets(
  candidates: unknown[],
  count: number,
  diversityRules: Required<DiversityRules>
): { ok: boolean; errors: string[]; validCandidates: Params[] } {
  const errors: string[] = [];
  if (!Array.isArray(candidates)) {
    return {
      ok: false,
      errors: ["candidates must be an array"],
      validCandidates: []
    };
  }

  if (candidates.length !== count) {
    errors.push(`candidates must contain exactly ${count} items (got ${candidates.length})`);
  }

  const validCandidates: Params[] = [];
  const signatures = new Set<string>();

  candidates.forEach((raw, index) => {
    const params = normalizeCandidate(raw);
    if (!params) {
      errors.push(`candidate[${index}] must be an object`);
      return;
    }

    let hasLocalError = false;
    for (const key of Object.keys(LLM_PARAM_ENUMS) as Array<keyof Params>) {
      const value = params[key];
      if (!(LLM_PARAM_ENUMS[key] as readonly string[]).includes(value)) {
        errors.push(`candidate[${index}].${key} invalid: ${value}`);
        hasLocalError = true;
      }
    }

    const signature = stableSignature(params);
    if (signatures.has(signature)) {
      errors.push(`candidate[${index}] duplicated params set`);
      hasLocalError = true;
    } else {
      signatures.add(signature);
    }

    if (!hasLocalError) {
      validCandidates.push(params);
    }
  });

  const densityMinEach = Math.max(0, Number(diversityRules.densityMinEach || 0));
  if (densityMinEach > 0) {
    for (const density of LLM_PARAM_ENUMS.densityProfile) {
      const hits = validCandidates.filter((item) => item.densityProfile === density).length;
      if (hits < densityMinEach) {
        errors.push(`densityProfile=${density} must appear at least ${densityMinEach} times (got ${hits})`);
      }
    }
  }

  const eraMaxRepeat = Math.max(1, Number(diversityRules.eraMaxRepeat || 1));
  for (const era of LLM_PARAM_ENUMS.era) {
    const hits = validCandidates.filter((item) => item.era === era).length;
    if (hits > eraMaxRepeat) {
      errors.push(`era=${era} must appear at most ${eraMaxRepeat} times (got ${hits})`);
    }
  }

  const vibeMinDistinct = Math.max(1, Number(diversityRules.vibeMinDistinct || 1));
  const distinctVibes = new Set(validCandidates.map((item) => item.vibe)).size;
  if (distinctVibes < vibeMinDistinct) {
    errors.push(`vibe must contain at least ${vibeMinDistinct} distinct values (got ${distinctVibes})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    validCandidates
  };
}

export function getRequestedCount(config: GenerationConfig): number {
  const byBoard = Number(config.familyCount || 0) * Number(config.variantsPerFamily || 0);
  const count = byBoard > 0 ? byBoard : Number(config.paramSetCount || 20);
  return clamp(Math.floor(count), 5, 200);
}

export function getNormalizedMode(config: GenerationConfig): EvolutionMode {
  return config.mode === "exploitation" ? "exploitation" : "exploration";
}

export function getNormalizedDiversityRules(
  rawRules: DiversityRules | undefined,
  count: number,
  mode: EvolutionMode
): Required<DiversityRules> {
  const rules: Required<DiversityRules> = {
    ...DEFAULT_DIVERSITY_RULES,
    ...(rawRules || {})
  };

  const maxEraSpread = Math.max(2, Math.ceil(count / LLM_PARAM_ENUMS.era.length));
  rules.eraMaxRepeat = Math.max(Number(rules.eraMaxRepeat || 2), maxEraSpread);

  rules.densityMinEach = count >= LLM_PARAM_ENUMS.densityProfile.length ? Number(rules.densityMinEach || 1) : 0;

  if (mode === "exploration") {
    rules.vibeMinDistinct = Math.min(
      Math.max(Number(rules.vibeMinDistinct || 6), 5),
      LLM_PARAM_ENUMS.vibe.length,
      count
    );
  } else {
    rules.vibeMinDistinct = Math.min(
      Math.max(Number(rules.vibeMinDistinct || 3), 2),
      LLM_PARAM_ENUMS.vibe.length,
      count
    );
  }

  return rules;
}

export function normalizeFocusFamilies(input: string[] | undefined): string[] {
  return Array.isArray(input)
    ? Array.from(
        new Set(
          input
            .map((v) => String(v || "").trim().toLowerCase())
            .filter((v) => v.includes("/"))
        )
      )
    : [];
}

export async function generateParamSets(
  job: EvolutionJob,
  llmClient: LlmClient,
  count: number,
  diversityRules: Required<DiversityRules>,
  mode: EvolutionMode,
  focusFamilies: string[]
): Promise<{ params: Params[]; validation: ParamValidation }> {
  const maxAttempts = 3;
  let attempts = 0;
  let current: unknown[] = [];
  let lastErrors: string[] = [];

  while (attempts < maxAttempts) {
    attempts += 1;

    if (attempts === 1) {
      const result = await llmClient.generateParamSets({
        targetUiId: job.targetUiId,
        baseThemeId: job.baseThemeId,
        count,
        mode,
        focusFamilies,
        enums: LLM_PARAM_ENUMS as unknown as Record<string, string[]>,
        diversityRules
      });
      current = Array.isArray(result?.candidates) ? result.candidates : [];
    } else {
      const repair = await llmClient.repairParamSets({
        targetUiId: job.targetUiId,
        baseThemeId: job.baseThemeId,
        count,
        mode,
        focusFamilies,
        enums: LLM_PARAM_ENUMS as unknown as Record<string, string[]>,
        diversityRules,
        previousCandidates: current,
        violations: lastErrors
      });
      current = Array.isArray(repair?.candidates) ? repair.candidates : current;
    }

    const validation = validateParamsSets(current, count, diversityRules);
    if (validation.ok) {
      return {
        params: validation.validCandidates,
        validation: {
          repaired: attempts > 1,
          attempts,
          errors: []
        }
      };
    }

    lastErrors = validation.errors;
    current = validation.validCandidates;
  }

  throw new Error(
    `LLM params generation failed after ${maxAttempts} attempts: ${lastErrors.join("; ") || "validation failed"}`
  );
}
