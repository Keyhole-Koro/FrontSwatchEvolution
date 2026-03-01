import express from "express";
import cors from "cors";
import path from "path";
import type { AddressInfo } from "net";
import { createJob, getJob, getCandidate } from "./store";
import { LlmClient, loadLlmConfig } from "./llm-client";
import { runEvolutionStream, type StreamRequest } from "./evolution/stream";
import { saveHistoryRecord, type HistoryEvent } from "./history";

const app = express();
const port = Number(process.env.PORT || 43102);
let llmClient: LlmClient;

try {
  loadLlmConfig();
  llmClient = new LlmClient();
} catch (error) {
  console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/artifacts", express.static(path.resolve(process.cwd(), "data", "artifacts")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "frontswatch-evolution" });
});

app.get("/llm/config", (_req, res) => {
  res.json(llmClient.getProviderInfo());
});

app.post("/evolution/jobs", (req, res) => {
  const job = createJob(req.body || {});
  res.json({ jobId: job.jobId, status: job.status });
});

app.post("/evolution/stream", async (req, res) => {
  const requestBody = (req.body || {}) as StreamRequest;
  const streamTimeline: HistoryEvent[] = [];
  const startedAt = new Date().toISOString();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (event: string, payload: Record<string, unknown>) => {
    streamTimeline.push({ ts: new Date().toISOString(), event, payload });
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runEvolutionStream(requestBody, emit);
    emit("stream.result", {
      totalCandidates: result.totalCandidates,
      topCandidates: result.topCandidates,
      genreBoard: result.genreBoard,
      paramGeneration: result.paramGeneration
    });
    emit("stream.done", { ok: true });

    saveHistoryRecord({
      jobId: `stream_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      source: "stream",
      status: "COMPLETED",
      createdAt: startedAt,
      updatedAt: new Date().toISOString(),
      targetUiId: requestBody.targetUiId || "default-ui",
      baseThemeId: requestBody.baseThemeId || "default",
      config: requestBody.generationConfig || {},
      timeline: streamTimeline,
      result,
      errorSummary: null
    });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    emit("stream.error", {
      message: errorObj.message,
      name: errorObj.name,
      stack: (errorObj.stack || "").split("\n").slice(0, 6).join("\n")
    });

    saveHistoryRecord({
      jobId: `stream_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      source: "stream",
      status: "FAILED",
      createdAt: startedAt,
      updatedAt: new Date().toISOString(),
      targetUiId: requestBody.targetUiId || "default-ui",
      baseThemeId: requestBody.baseThemeId || "default",
      config: requestBody.generationConfig || {},
      timeline: streamTimeline,
      result: null,
      errorSummary: errorObj.message
    });
  } finally {
    res.end();
  }
});

app.get("/evolution/jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    errorSummary: job.errorSummary,
    topCandidates: job.result ? job.result.topCandidates : [],
    totalCandidates: job.result ? job.result.totalCandidates : 0,
    genreBoard: job.result ? job.result.genreBoard : [],
    paramGeneration: job.result ? job.result.paramGeneration : null,
    timeline: job.timeline || [],
    updatedAt: job.updatedAt
  });
});

app.get("/evolution/jobs/:jobId/candidates/:candidateId", (req, res) => {
  const candidate = getCandidate(req.params.jobId, req.params.candidateId);
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json(candidate);
});

const server = app.listen(port, () => {
  const addr = server.address() as AddressInfo | null;
  const bindPort = addr?.port || port;
  console.log(`FrontSwatchEvolution API listening on :${bindPort}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[FATAL] Port ${port} is already in use. Stop the old process or set PORT to another value.`);
    process.exit(1);
  }
  console.error(`[FATAL] Server error: ${error.message}`);
  process.exit(1);
});

let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[INFO] Received ${signal}. Shutting down FrontSwatchEvolution...`);
  server.close((error) => {
    if (error) {
      console.error(`[FATAL] Shutdown failed: ${error.message}`);
      process.exit(1);
      return;
    }
    console.log("[INFO] FrontSwatchEvolution stopped.");
    process.exit(0);
  });
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
