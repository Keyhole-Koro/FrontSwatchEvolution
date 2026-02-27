export type TypeProfile = "neoGrotesk" | "humanist" | "geometric" | "serifEditorial" | "monoAccent";

export type Params = {
  vibe: string;
  era: string;
  densityProfile: string;
  elevationProfile: string;
  radiusProfile: string;
  colorStrategy: string;
};

export type DiversityRules = {
  densityMinEach?: number;
  eraMaxRepeat?: number;
  vibeMinDistinct?: number;
};

export type EvolutionMode = "exploration" | "exploitation";

export type GenerationConfig = {
  paramSetCount?: number;
  familyCount?: number;
  variantsPerFamily?: number;
  mode?: EvolutionMode;
  focusFamilies?: string[];
  diversityRules?: DiversityRules;
  llmProvider?: "mock" | "gemini" | "nova";
  useLLMAesthetic?: boolean;
};

export type EvolutionJob = {
  jobId: string;
  baseThemeId: string;
  targetUiId: string;
  config: GenerationConfig;
};

export type DesignDNA = {
  params: Params;
  resolvedProfiles: { typeProfile: TypeProfile };
  palette: { hueShift: number; saturationScale: number; lightnessBias: number };
  typography: { scale: number; weightBias: number };
  surfaces: { radiusScale: number; radiusBase: number; shadowDepth: number; shadowOpacity: number };
  spacing: { scale: number; density: number };
};

export type CandidateScores = {
  readability: number;
  layoutSafety: number;
  brandConsistency: number;
  aesthetics: number;
  diversityBonus: number;
  score: number;
};

export type Candidate = {
  candidateId: string;
  generation: number;
  params: Params;
  visualFamilyId: string;
  genre: { id: string; mood: string; domain: string; density: number };
  designDNA: DesignDNA;
  tokenPatch: Record<string, number>;
  scores: CandidateScores;
  artifactPaths: { screenshot: string; qaReport: string };
  rank?: number;
  llmAesthetic?: { provider: unknown; reason: string | null; riskFlags: string[] };
};

export type ParamValidation = {
  repaired: boolean;
  attempts: number;
  errors: string[];
};

export type EvolutionResult = {
  totalCandidates: number;
  topCandidates: Candidate[];
  allCandidates: Candidate[];
  genreBoard: Array<{ familyId: string; label: string; candidates: Candidate[] }>;
  llm: Record<string, unknown>;
  paramGeneration: {
    count: number;
    mode: EvolutionMode;
    enums: Record<string, readonly string[]>;
    diversityRules: Required<DiversityRules>;
    validation: ParamValidation;
  };
};
