import crypto from "crypto";
import { runEvolution, type EvolutionJob, type EvolutionResult } from "./evolution";

type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

type Job = EvolutionJob & {
  status: JobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  result: EvolutionResult | null;
  errorSummary: string | null;
};

const jobs = new Map<string, Job>();

function now(): string {
  return new Date().toISOString();
}

export function createJob(payload: any): Job {
  const jobId = `evo_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const job: Job = {
    jobId,
    status: "QUEUED",
    progress: 0,
    baseThemeId: payload.baseThemeId || "default",
    targetUiId: payload.targetUiId || "default-ui",
    config: {
      paramSetCount: payload.generationConfig?.paramSetCount || 20,
      familyCount: payload.generationConfig?.familyCount,
      variantsPerFamily: payload.generationConfig?.variantsPerFamily,
      mode: payload.generationConfig?.mode || "exploration",
      focusFamilies: payload.generationConfig?.focusFamilies || [],
      diversityRules: payload.generationConfig?.diversityRules || {},
      llmProvider: payload.generationConfig?.llmProvider || process.env.LLM_PROVIDER || "mock",
      useLLMAesthetic: Boolean(payload.generationConfig?.useLLMAesthetic)
    },
    createdAt: now(),
    updatedAt: now(),
    result: null,
    errorSummary: null
  };

  jobs.set(jobId, job);

  setTimeout(async () => {
    try {
      job.status = "RUNNING";
      job.progress = 35;
      job.updatedAt = now();

      const result = await runEvolution(job);
      job.progress = 100;
      job.status = "COMPLETED";
      job.result = result;
      job.updatedAt = now();
    } catch (error) {
      job.status = "FAILED";
      job.errorSummary = error instanceof Error ? error.message : String(error);
      job.updatedAt = now();
    }
  }, 50);

  return job;
}

export function getJob(jobId: string): Job | null {
  return jobs.get(jobId) || null;
}

export function getCandidate(jobId: string, candidateId: string): EvolutionResult["allCandidates"][number] | null {
  const job = getJob(jobId);
  if (!job || !job.result) return null;
  return job.result.allCandidates.find((candidate) => candidate.candidateId === candidateId) || null;
}
