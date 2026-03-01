import fs from "fs";
import path from "path";
import type { EvolutionResult } from "./evolution";
import type { GenerationConfig } from "./evolution/types";

export type HistoryEvent = {
  ts: string;
  event: string;
  payload?: Record<string, unknown>;
};

type HistorySource = "job" | "stream";

export type HistoryRecord = {
  jobId: string;
  source: HistorySource;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  targetUiId: string;
  baseThemeId: string;
  config: GenerationConfig;
  timeline: HistoryEvent[];
  result: EvolutionResult | null;
  errorSummary: string | null;
};

const HISTORY_DIR = path.resolve(__dirname, "../data/history");

function ensureHistoryDir(): void {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function historyFilePath(jobId: string): string {
  return path.join(HISTORY_DIR, `${jobId}.json`);
}

export function saveHistoryRecord(record: HistoryRecord): void {
  ensureHistoryDir();
  fs.writeFileSync(historyFilePath(record.jobId), JSON.stringify(record, null, 2));
}

export function loadHistoryRecord(jobId: string): HistoryRecord | null {
  const filePath = historyFilePath(jobId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as HistoryRecord;
  } catch {
    return null;
  }
}

function listHistoryFilesByRecent(): string[] {
  ensureHistoryDir();
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(HISTORY_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

export function loadRecentFocusFamilies(maxFamilies = 8, maxJobs = 12): string[] {
  const out = new Set<string>();
  const files = listHistoryFilesByRecent().slice(0, maxJobs);

  for (const filePath of files) {
    if (out.size >= maxFamilies) break;
    try {
      const record = JSON.parse(fs.readFileSync(filePath, "utf-8")) as HistoryRecord;
      if (record.status !== "COMPLETED" || !record.result) continue;

      for (const family of record.result.genreBoard || []) {
        if (typeof family?.familyId === "string" && family.familyId.includes("/")) {
          out.add(family.familyId.toLowerCase());
          if (out.size >= maxFamilies) break;
        }
      }

      if (out.size < maxFamilies) {
        for (const candidate of record.result.topCandidates || []) {
          if (typeof candidate?.visualFamilyId === "string" && candidate.visualFamilyId.includes("/")) {
            out.add(candidate.visualFamilyId.toLowerCase());
            if (out.size >= maxFamilies) break;
          }
        }
      }
    } catch {
      // ignore corrupted history file
    }
  }

  return Array.from(out).slice(0, maxFamilies);
}
