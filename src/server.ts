import express from "express";
import cors from "cors";
import { createJob, getJob, getCandidate } from "./store";
import { LlmClient, loadLlmConfig } from "./llm-client";
import { runEvolutionStream } from "./evolution/stream";

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
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (event: string, payload: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runEvolutionStream(req.body || {}, emit);
    emit("stream.result", {
      totalCandidates: result.totalCandidates,
      topCandidates: result.topCandidates,
      genreBoard: result.genreBoard,
      paramGeneration: result.paramGeneration
    });
    emit("stream.done", { ok: true });
  } catch (error) {
    emit("stream.error", {
      message: error instanceof Error ? error.message : String(error)
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

app.listen(port, () => {
  console.log(`FrontSwatchEvolution API listening on :${port}`);
});
