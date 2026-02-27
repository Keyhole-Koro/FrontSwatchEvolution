# FrontSwatchEvolution

Evolution engine service for diverse UI design proposal generation.

## What it does
- Generates `N` parameter sets from fixed visual-family enums
- Uses `LLM generate -> machine validate -> LLM repair` loop
- Keeps LLM on discrete style tags, machine on concrete token values
- Expands params into implementation-safe Design DNA + token patches
- Ranks candidates with quality + diversity-aware scoring
- Builds a `genreBoard` for human selection (family shelves)

## Local run
```bash
npm install
cp config/llm-config.example.json config/llm-config.json
npm run dev
```

Default port: `43102`

Build for production:
```bash
npm run build
npm run start
```

## API
- `GET /healthz`
- `GET /llm/config`
- `POST /evolution/jobs`
- `POST /evolution/stream` (SSE stream response)
- `GET /evolution/jobs/{jobId}`
- `GET /evolution/jobs/{jobId}/candidates/{candidateId}`

## Example
```bash
curl -X POST http://localhost:43102/evolution/jobs \
  -H 'content-type: application/json' \
  -d '{
    "baseThemeId": "classic-navy",
    "targetUiId": "dashboard",
    "generationConfig": {
      "paramSetCount": 20,
      "mode": "exploration",
      "llmProvider": "mock",
      "useLLMAesthetic": false,
      "diversityRules": {
        "densityMinEach": 1,
        "eraMaxRepeat": 2,
        "vibeMinDistinct": 5
      }
    }
  }'
```

Exploitation example (deepen selected families):
```bash
curl -X POST http://localhost:43102/evolution/jobs \
  -H 'content-type: application/json' \
  -d '{
    "generationConfig": {
      "mode": "exploitation",
      "familyCount": 3,
      "variantsPerFamily": 4,
      "focusFamilies": ["premium/modern", "editorial/retro", "minimal/swiss"]
    }
  }'
```

Then query job status:
```bash
curl http://localhost:43102/evolution/jobs/<jobId>
```

Streamed generation example:
```bash
curl -N -X POST http://localhost:43102/evolution/stream \
  -H 'content-type: application/json' \
  -d '{
    "targetUiId": "dashboard",
    "preferenceStream": [
      { "type": "like", "value": "premium modern" },
      { "type": "pin", "familyId": "editorial/retro" },
      { "type": "like", "value": "minimal swiss" }
    ],
    "generationConfig": {
      "llmProvider": "mock",
      "mode": "exploration"
    }
  }'
```

## Parameter enum space
- `vibe`: calm, bold, playful, premium, industrial, minimal, editorial
- `era`: modern, y2k, retro, neo-brutalist, swiss, bauhaus
- `densityProfile`: compact, comfortable, airy
- `elevationProfile`: flat, soft, crisp, dramatic
- `radiusProfile`: sharp, rounded, pill
- `colorStrategy`: monoAccent, dualAccent, pastel, highContrast, earthTone, neon

Type profile is resolved by the engine (machine-side), not requested from LLM.

## Notes
- LLM client supports `mock | gemini | nova`.
- Startup fails if `config/llm-config.json` is missing or invalid.
- Secrets should be loaded via env vars referenced from JSON config.
- Job config is `paramSetCount` + `diversityRules` centric.
