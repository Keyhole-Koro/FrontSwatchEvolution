import type { DiversityRules } from "./types";

export const LLM_PARAM_ENUMS = {
  vibe: ["calm", "bold", "playful", "premium", "industrial", "minimal", "editorial"],
  era: ["modern", "y2k", "retro", "neo-brutalist", "swiss", "bauhaus"],
  densityProfile: ["compact", "comfortable", "airy"],
  elevationProfile: ["flat", "soft", "crisp", "dramatic"],
  radiusProfile: ["sharp", "rounded", "pill"],
  colorStrategy: ["monoAccent", "dualAccent", "pastel", "highContrast", "earthTone", "neon"]
} as const;

export const TYPE_PROFILES = ["neoGrotesk", "humanist", "geometric", "serifEditorial", "monoAccent"] as const;

export const PROFILE_PRESETS = {
  densityProfile: {
    compact: { density: 0.95, spacingScale: 0.88 },
    comfortable: { density: 0.82, spacingScale: 1.0 },
    airy: { density: 0.68, spacingScale: 1.12 }
  },
  elevationProfile: {
    flat: { shadowDepth: 0, shadowOpacity: 0.0 },
    soft: { shadowDepth: 2, shadowOpacity: 0.12 },
    crisp: { shadowDepth: 3, shadowOpacity: 0.18 },
    dramatic: { shadowDepth: 4, shadowOpacity: 0.24 }
  },
  radiusProfile: {
    sharp: { radiusScale: 0.75, radiusBase: 4 },
    rounded: { radiusScale: 1.0, radiusBase: 10 },
    pill: { radiusScale: 1.35, radiusBase: 16 }
  },
  typeProfile: {
    neoGrotesk: { typeScale: 1.0, weightBias: 40 },
    humanist: { typeScale: 1.02, weightBias: 0 },
    geometric: { typeScale: 1.03, weightBias: 20 },
    serifEditorial: { typeScale: 1.05, weightBias: -10 },
    monoAccent: { typeScale: 0.98, weightBias: 70 }
  },
  colorStrategy: {
    monoAccent: { hueShift: 8, saturationScale: 1.0, lightnessBias: 0.0 },
    dualAccent: { hueShift: 20, saturationScale: 1.1, lightnessBias: 0.0 },
    pastel: { hueShift: -8, saturationScale: 0.82, lightnessBias: 0.08 },
    highContrast: { hueShift: 0, saturationScale: 1.2, lightnessBias: -0.04 },
    earthTone: { hueShift: -18, saturationScale: 0.9, lightnessBias: -0.02 },
    neon: { hueShift: 28, saturationScale: 1.28, lightnessBias: 0.02 }
  }
} as const;

export const DEFAULT_DIVERSITY_RULES: Required<DiversityRules> = {
  densityMinEach: 1,
  eraMaxRepeat: 2,
  vibeMinDistinct: 5
};
