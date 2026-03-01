import fs from "fs";
import path from "path";
import { LlmClient } from "../llm-client";
import type { Candidate } from "./types";

type QAReport = {
  candidateId: string;
  generatedAt: string;
  render: { engine: "playwright-react-tailwind"; error: string | null };
  checks: {
    contrast: { status: "PASS" | "WARN"; reason: string };
    overflow: { status: "PASS" | "WARN"; reason: string };
  };
  notes: string[];
};

function artifactDir(jobId: string): string {
  return path.resolve(process.cwd(), "data", "artifacts", jobId);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeGeneratedTsx(tsx: string): string {
  const noFences = String(tsx || "")
    .trim()
    .replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/m, "$1");

  // Browser runtime script handles globals; imports/exports break Babel runtime eval.
  const withoutImports = noFences
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(/export\s+default\s+function\s+GeneratedSpecimen\s*\(/, "function GeneratedSpecimen(")
    .replace(/export\s+default\s+GeneratedSpecimen\s*;?/, "");

  return withoutImports.trim();
}

function reactTailwindHtml(tsxCode: string): string {
  const source = normalizeGeneratedTsx(tsxCode);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    html, body, #root { margin: 0; min-height: 100%; background: #fff; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="typescript,react">
${source}
if (typeof GeneratedSpecimen !== "function") {
  throw new Error("GeneratedSpecimen function is missing in generated TSX");
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(GeneratedSpecimen));
  </script>
</body>
</html>`;
}

function buildQaReport(candidate: Candidate, renderError: string | null): QAReport {
  const readability = candidate.scores.readability;
  const layout = candidate.scores.layoutSafety;
  return {
    candidateId: candidate.candidateId,
    generatedAt: new Date().toISOString(),
    render: { engine: "playwright-react-tailwind", error: renderError },
    checks: {
      contrast: {
        status: readability >= 0.7 ? "PASS" : "WARN",
        reason: `readability score=${readability.toFixed(3)}`
      },
      overflow: {
        status: layout >= 0.7 ? "PASS" : "WARN",
        reason: `layoutSafety score=${layout.toFixed(3)}`
      }
    },
    notes: []
  };
}

export async function attachArtifacts(
  jobId: string,
  candidates: Candidate[],
  llmClient: LlmClient
): Promise<Candidate[]> {
  const dir = artifactDir(jobId);
  ensureDir(dir);

  let browser: any = null;
  try {
    const playwright = await import("playwright");
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    const renderError = error instanceof Error ? error.message : String(error);
    throw new Error(`artifact rendering failed: ${renderError}`);
  }

  try {
    const updated: Candidate[] = [];

    for (const candidate of candidates) {
      const qaFile = `${candidate.candidateId}.qa.json`;
      const reactTsxFile = `${candidate.candidateId}.generated.tsx`;
      const pngFile = `${candidate.candidateId}.png`;
      const qaPath = path.join(dir, qaFile);
      const reactTsxPath = path.join(dir, reactTsxFile);
      const pngPath = path.join(dir, pngFile);

      const generatedTsx = await llmClient.generateReactComponent({
        candidateId: candidate.candidateId,
        visualFamilyId: candidate.visualFamilyId,
        params: candidate.params
      });

      fs.writeFileSync(reactTsxPath, `${generatedTsx.trim()}\n`, "utf-8");

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const pageErrors: string[] = [];
      page.on("pageerror", (err: Error) => pageErrors.push(err.message));

      await page.setContent(reactTailwindHtml(generatedTsx), { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);

      if (pageErrors.length > 0) {
        await page.close();
        throw new Error(`generated TSX runtime error: ${pageErrors.join(" | ")}`);
      }

      await page.screenshot({ path: pngPath, fullPage: true, type: "png" });
      await page.close();

      fs.writeFileSync(qaPath, JSON.stringify(buildQaReport(candidate, null), null, 2));

      updated.push({
        ...candidate,
        artifactPaths: {
          screenshot: `/artifacts/${jobId}/${pngFile}`,
          qaReport: `/artifacts/${jobId}/${qaFile}`,
          sourceReactTsx: `/artifacts/${jobId}/${reactTsxFile}`
        }
      });
    }

    return updated;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
