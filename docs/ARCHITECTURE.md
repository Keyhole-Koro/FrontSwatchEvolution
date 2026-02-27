# Architecture

## Flow
1. `POST /evolution/jobs`
2. Job store creates evolution job
3. Engine runs:
   - genre brainstorm presets
   - mutation per generation
   - candidate scoring
   - diversity-aware top-K selection
4. `GET /evolution/jobs/{jobId}` returns top candidates

## Candidate Contract
Each candidate includes:
- `candidateId`
- `generation`
- `genre`
- `designDNA`
- `tokenPatch`
- `scores`
- `artifactPaths`

## Planned Extensions
- Nova-driven genre brainstorming
- Nova aesthetic scoring with strict JSON schema
- Playwright rendering + QA integration
- Persistence backend (DynamoDB/S3)
