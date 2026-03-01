import crypto from "crypto";
import { runEvolution, type EvolutionJob, type EvolutionResult } from "./evolution";
import { loadRecentFocusFamilies, saveHistoryRecord, type HistoryEvent } from "./history";

type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

type Job = EvolutionJob & {
  status: JobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  timeline: HistoryEvent[];
  result: EvolutionResult | null;
  errorSummary: string | null;
};

const jobs = new Map<string, Job>();

function now(): string {
  return new Date().toISOString();
}

function appendJobEvent(job: Job, event: string, payload?: Record<string, unknown>): void {
  const entry: HistoryEvent = { ts: now(), event, payload };
  job.timeline.push(entry);
  job.updatedAt = entry.ts;
}

function persistJob(job: Job): void {
  saveHistoryRecord({
    jobId: job.jobId,
    source: "job",
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    targetUiId: job.targetUiId,
    baseThemeId: job.baseThemeId,
    config: job.config,
    timeline: job.timeline,
    result: job.result,
    errorSummary: job.errorSummary
  });
}

export function createJob(payload: any): Job {
  const requestedFocusFamilies = Array.isArray(payload?.generationConfig?.focusFamilies)
    ? payload.generationConfig.focusFamilies
    : [];
  const autoFocusFamilies = requestedFocusFamilies.length > 0 ? [] : loadRecentFocusFamilies(8, 12);

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
      focusFamilies: requestedFocusFamilies.length > 0 ? requestedFocusFamilies : autoFocusFamilies,
      diversityRules: payload.generationConfig?.diversityRules || {},
      llmProvider: payload.generationConfig?.llmProvider || process.env.LLM_PROVIDER,
      useLLMAesthetic: Boolean(payload.generationConfig?.useLLMAesthetic)
    },
    createdAt: now(),
    updatedAt: now(),
    timeline: [],
    result: null,
    errorSummary: null
  };

  appendJobEvent(job, "job.queued", {
    reusedFocusFamilies: autoFocusFamilies,
    requestedFocusFamilies
  });
  persistJob(job);
  jobs.set(jobId, job);

  setTimeout(async () => {
    try {
      job.status = "RUNNING";
      job.progress = 35;
      appendJobEvent(job, "job.running", {
        paramSetCount: job.config.paramSetCount,
        mode: job.config.mode,
        focusFamilies: job.config.focusFamilies || []
      });
      persistJob(job);

      const result = await runEvolution(job);
      job.progress = 100;
      job.status = "COMPLETED";
      job.result = result;
      appendJobEvent(job, "job.completed", {
        totalCandidates: result.totalCandidates,
        topCandidates: result.topCandidates.length,
        boardFamilies: result.genreBoard.length
      });
      persistJob(job);
    } catch (error) {
      job.status = "FAILED";
      job.errorSummary = error instanceof Error ? error.message : String(error);
      appendJobEvent(job, "job.failed", {
        message: job.errorSummary
      });
      persistJob(job);
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
