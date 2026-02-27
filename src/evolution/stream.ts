import crypto from "crypto";
import { LLM_PARAM_ENUMS } from "./constants";
import { runEvolution } from "./run";
import type { DiversityRules, EvolutionJob, EvolutionMode, EvolutionResult, GenerationConfig } from "./types";

type PreferenceEvent = {
  type?: "like" | "dislike" | "pin" | string;
  value?: string;
  familyId?: string;
  weight?: number;
};

type StreamRequest = {
  targetUiId?: string;
  baseThemeId?: string;
  generationConfig?: GenerationConfig;
  preferenceStream?: PreferenceEvent[];
};

export type StreamEmitter = (event: string, payload: Record<string, unknown>) => void;

function normalizeFamilyId(raw: string): string | null {
  const v = String(raw || "").trim().toLowerCase();
  if (!v.includes("/")) return null;
  const [vibe, era] = v.split("/");
  if (!(LLM_PARAM_ENUMS.vibe as readonly string[]).includes(vibe)) return null;
  if (!(LLM_PARAM_ENUMS.era as readonly string[]).includes(era)) return null;
  return `${vibe}/${era}`;
}

function parseFamilyFromText(text: string): string | null {
  const normalized = text.toLowerCase();
  const vibe = LLM_PARAM_ENUMS.vibe.find((item) => normalized.includes(item));
  const era = LLM_PARAM_ENUMS.era.find((item) => normalized.includes(item));
  if (!vibe || !era) return null;
  return `${vibe}/${era}`;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function broadenFamilies(seedFamilies: string[], target = 8): string[] {
  const out = new Set<string>(seedFamilies);

  for (const family of seedFamilies) {
    const [vibe, era] = family.split("/");
    for (const nearEra of LLM_PARAM_ENUMS.era) {
      if (out.size >= target) break;
      out.add(`${vibe}/${nearEra}`);
    }
    for (const nearVibe of LLM_PARAM_ENUMS.vibe) {
      if (out.size >= target) break;
      out.add(`${nearVibe}/${era}`);
    }
    if (out.size >= target) break;
  }

  for (const vibe of LLM_PARAM_ENUMS.vibe) {
    for (const era of LLM_PARAM_ENUMS.era) {
      if (out.size >= target) break;
      out.add(`${vibe}/${era}`);
    }
    if (out.size >= target) break;
  }

  return Array.from(out).slice(0, target);
}

function deriveConfigFromPreferences(
  generationConfig: GenerationConfig | undefined,
  events: PreferenceEvent[]
): GenerationConfig {
  const explicitFamilies = events
    .map((event) => normalizeFamilyId(event.familyId || ""))
    .filter(Boolean) as string[];

  const textFamilies = events
    .map((event) => parseFamilyFromText(event.value || ""))
    .filter(Boolean) as string[];

  const pinnedFamilies = events
    .filter((event) => event.type === "pin")
    .map((event) => normalizeFamilyId(event.familyId || event.value || ""))
    .filter(Boolean) as string[];

  const seedFamilies = unique([...explicitFamilies, ...textFamilies, ...pinnedFamilies]);
  const focusFamilies = broadenFamilies(seedFamilies, Math.max(6, seedFamilies.length * 3));

  const mode: EvolutionMode =
    generationConfig?.mode || (pinnedFamilies.length > 0 || focusFamilies.length > 0 ? "exploitation" : "exploration");

  const baseFamilyCount = Number(generationConfig?.familyCount || 0);
  const familyCount = Math.max(baseFamilyCount, Math.min(8, Math.max(3, focusFamilies.length || 4)));
  const variantsPerFamily = Number(generationConfig?.variantsPerFamily || 4);

  const baseRules = generationConfig?.diversityRules || {};
  const diversityRules: DiversityRules = {
    densityMinEach: baseRules.densityMinEach ?? 1,
    eraMaxRepeat: baseRules.eraMaxRepeat ?? Math.max(2, Math.ceil((familyCount * variantsPerFamily) / 6)),
    vibeMinDistinct: baseRules.vibeMinDistinct ?? (mode === "exploration" ? 5 : 3)
  };

  return {
    ...generationConfig,
    mode,
    familyCount,
    variantsPerFamily,
    paramSetCount: Number(generationConfig?.paramSetCount || familyCount * variantsPerFamily),
    focusFamilies,
    diversityRules
  };
}

export async function runEvolutionStream(
  request: StreamRequest,
  emit: StreamEmitter
): Promise<EvolutionResult> {
  const streamId = `stream_${crypto.randomUUID().slice(0, 10)}`;
  const events = Array.isArray(request.preferenceStream) ? request.preferenceStream : [];

  emit("stream.started", {
    streamId,
    receivedPreferenceEvents: events.length,
    targetUiId: request.targetUiId || "default-ui"
  });

  events.forEach((event, idx) => {
    emit("preference.processed", {
      index: idx,
      type: event.type || "like",
      value: event.value || null,
      familyId: event.familyId || null
    });
  });

  const derivedConfig = deriveConfigFromPreferences(request.generationConfig, events);
  emit("preferences.expanded", {
    mode: derivedConfig.mode,
    focusFamilies: derivedConfig.focusFamilies || [],
    paramSetCount: derivedConfig.paramSetCount,
    diversityRules: derivedConfig.diversityRules
  });

  const job: EvolutionJob = {
    jobId: `evo_stream_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
    baseThemeId: request.baseThemeId || "default",
    targetUiId: request.targetUiId || "default-ui",
    config: derivedConfig
  };

  emit("generation.started", {
    jobId: job.jobId,
    mode: derivedConfig.mode,
    requestedCandidates: derivedConfig.paramSetCount
  });

  const result = await runEvolution(job);

  for (const family of result.genreBoard) {
    emit("family.generated", {
      familyId: family.familyId,
      label: family.label,
      count: family.candidates.length
    });
  }

  for (const candidate of result.topCandidates) {
    emit("candidate.selected", {
      candidateId: candidate.candidateId,
      familyId: candidate.visualFamilyId,
      rank: candidate.rank,
      score: candidate.scores.score
    });
  }

  emit("generation.completed", {
    jobId: job.jobId,
    totalCandidates: result.totalCandidates,
    topCandidates: result.topCandidates.length,
    boardFamilies: result.genreBoard.length
  });

  return result;
}
