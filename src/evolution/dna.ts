import { PROFILE_PRESETS } from "./constants";
import { clamp, rand } from "./utils";
import type { DesignDNA, Params, TypeProfile } from "./types";

export function buildDesignDNA(params: Params): DesignDNA {
  const density = PROFILE_PRESETS.densityProfile[params.densityProfile as keyof typeof PROFILE_PRESETS.densityProfile];
  const elevation =
    PROFILE_PRESETS.elevationProfile[params.elevationProfile as keyof typeof PROFILE_PRESETS.elevationProfile];
  const radius = PROFILE_PRESETS.radiusProfile[params.radiusProfile as keyof typeof PROFILE_PRESETS.radiusProfile];
  const color = PROFILE_PRESETS.colorStrategy[params.colorStrategy as keyof typeof PROFILE_PRESETS.colorStrategy];
  const typeProfile: TypeProfile = "humanist";
  const type = PROFILE_PRESETS.typeProfile[typeProfile];

  const jitter = {
    hueShift: clamp(color.hueShift + rand(-3, 3), -30, 30),
    saturationScale: clamp(color.saturationScale + rand(-0.05, 0.05), 0.75, 1.35),
    lightnessBias: clamp(color.lightnessBias + rand(-0.02, 0.02), -0.12, 0.12),
    typeScale: clamp(type.typeScale + rand(-0.03, 0.03), 0.85, 1.35),
    spacingScale: clamp(density.spacingScale + rand(-0.03, 0.03), 0.8, 1.35),
    radiusScale: clamp(radius.radiusScale + rand(-0.05, 0.05), 0.65, 1.7)
  };

  return {
    params,
    resolvedProfiles: { typeProfile },
    palette: {
      hueShift: jitter.hueShift,
      saturationScale: jitter.saturationScale,
      lightnessBias: jitter.lightnessBias
    },
    typography: {
      scale: jitter.typeScale,
      weightBias: type.weightBias
    },
    surfaces: {
      radiusScale: jitter.radiusScale,
      radiusBase: radius.radiusBase,
      shadowDepth: elevation.shadowDepth,
      shadowOpacity: elevation.shadowOpacity
    },
    spacing: {
      scale: jitter.spacingScale,
      density: density.density
    }
  };
}

export function tokenPatchFromDNA(dna: DesignDNA): Record<string, number> {
  return {
    "--hue-shift": Number(dna.palette.hueShift.toFixed(2)),
    "--sat-scale": Number(dna.palette.saturationScale.toFixed(3)),
    "--lightness-bias": Number(dna.palette.lightnessBias.toFixed(3)),
    "--type-scale": Number(dna.typography.scale.toFixed(3)),
    "--weight-bias": Math.round(dna.typography.weightBias),
    "--radius-scale": Number(dna.surfaces.radiusScale.toFixed(3)),
    "--radius-base": dna.surfaces.radiusBase,
    "--shadow-depth": dna.surfaces.shadowDepth,
    "--shadow-opacity": Number(dna.surfaces.shadowOpacity.toFixed(2)),
    "--spacing-scale": Number(dna.spacing.scale.toFixed(3)),
    "--density": Number(dna.spacing.density.toFixed(3))
  };
}
