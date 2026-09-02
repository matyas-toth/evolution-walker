# EvoWalker

EvoWalker is an interactive evolutionary-robotics playground. You draw a particle-and-muscle creature, train a population in the browser, compare compute backends, and save or replay successful genomes. The training policy favors forward progress while rewarding sustained posture and support changes, so recognizable—sometimes delightfully awkward—gaits can emerge without a hard-coded locomotion controller.

## Highlights

- Visual creature editor with particles, rigid constraints, muscles, undo/redo, and preview.
- Automatic support/leg detection for one, two, four, five, or more supports.
- Optional per-particle `support`, `body`, and gait-group overrides in the editor.
- Deterministic 60/40 rhythmic/random population seeding and reproducible training seeds.
- Packed CPU, Rust/WASM scalar, Rust/WASM SIMD, multicore WASM, and WebGPU backends.
- Versioned training sessions, exact winner replay, authentication, and MariaDB persistence.
- Unit, component, Rust, WASM ABI, integration, E2E, and benchmark suites.

## Architecture

The Next.js app owns editing, authentication, persistence, and rendering. Training itself runs outside React in a dedicated coordinator worker. The coordinator creates one deterministic initial population and passes it to the selected backend, so switching backend does not silently change the starting genomes.

```text
React / Next.js UI
        |
TrainingEngineClient
        |
coordinator Web Worker
        |
        +-- packed TypeScript CPU fallback
        +-- Rust/WASM scalar
        +-- Rust/WASM SIMD evaluation shards + global selection
        `-- WebGPU compute shader
```

The deployable Rust artifacts are committed as `public/training-engine-scalar.wasm` and `public/training-engine-simd.wasm`. Saved sessions store JSON genomes, `TrainingHubConfig`, and optional policy-v3 archive/RNG state; live physics slabs stay worker-local. Older policy-v2 sessions are upgraded without resetting their generation or population, and their saved champion is inserted for re-evaluation.

## Prerequisites

- Node.js **22.19 or newer** and npm 10. The dependency set includes Undici 8, which raises the effective minimum above the original Node 22.12 target.
- Rust **1.93.1** (pinned by `rust-toolchain.toml`).
- The `wasm32-unknown-unknown` Rust target. Rustup installs it from the toolchain file; otherwise run `rustup target add wasm32-unknown-unknown`.
- Docker Desktop or another Docker-compatible runtime for integration, E2E, and benchmark tests.
- MariaDB 11.x or compatible MySQL for local development.
- Chromium installed by Playwright for browser tests: `npx playwright install chromium`.
- Optional `wat2wasm` only for rebuilding the older `public/physics.wasm` artifact with `npm run build:wasm`.

## Setup

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and replace the dummy database credentials and `AUTH_SECRET`.

3. Create the development database, then apply migrations:

   ```bash
   npm run db:migrate:dev -- --name local_setup
   ```

4. Generate Prisma Client and build both Rust training engines:

   ```bash
   npm run setup
   ```

5. Start development:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000).

### Database configuration

Prisma CLI reads `DATABASE_URL` through `prisma.config.ts`. The application uses Prisma 7's `PrismaMariaDb` driver adapter. At runtime it prefers `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_DB`; if those are absent it parses `DATABASE_URL`.

Useful commands:

```bash
npm run db:generate
npm run db:migrate:dev -- --name descriptive_change
npm run db:migrate:deploy
npx prisma migrate status
npx prisma studio
```

Production deployments should run `npm run db:migrate:deploy` before starting the application. Never use `migrate dev` against production.

## Training and saved sessions

The Training Hub chooses a backend automatically, or you can force `webgpu`, `wasm-simd`, `wasm-scalar`, or `legacy` in the sidebar. Reproducible URL parameters are also supported:

```text
/dashboard/creatures/<id>/train?backend=wasm-simd&population=500&duration=10&seed=1831565813
```

Fresh training and reset use the gait-aware seed population. Loading a saved session never replaces its genomes. Switching compute backend exports and imports the current population, then replays the partial generation so visible progress is retained.

The progress chart reports all-time best sustained distance, generation p90 distance, generation median distance, and the target reference. Policy-v2 and policy-v3 compatibility fitness values are not directly comparable; use sustained distance and fixed-budget quality benchmarks instead.

## Commands and tests

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript check |
| `npm run test:unit` | Unit, packed-engine, and committed WASM ABI tests |
| `npm run test:component` | React hooks and UI behavior in jsdom |
| `npm run test:engine` | Native Rust engine tests |
| `npm run test:integration` | Prisma/API tests in disposable MariaDB 11.4 |
| `npm run test:e2e` | Chromium journeys with disposable MariaDB |
| `npm run test:coverage` | V8 coverage report and thresholds |
| `npm run test:quality` | Fast deterministic policy-v3 locomotion gate |
| `npm run test:quality:statistical` | Explicit long-running statistical locomotion gate |
| `npm run test:benchmark` | Production build plus backend benchmark matrix |
| `npm run verify:fast` | Docker-free lint, types, unit, component, and Rust checks |
| `npm run verify` | Full correctness gate including build, integration, and E2E |

Integration and E2E scripts create an isolated `evolution_test` database through Testcontainers. They refuse to use a URL without that database name and stop the container in `finally`, so the development database is not touched.

### Quality benchmarks

`test:quality` is a small deterministic PR smoke gate. The explicit statistical command runs the long fixed-seed locomotion acceptance workload; hardware-specific throughput results belong in `benchmarks/results/` and are gitignored.

Run the long deterministic gate explicitly:

```bash
npm run test:quality:statistical
```

See `tests/README.md` and `benchmarks/README.md` for suite layout and environment filters.

## WASM builds

After changing `src-wasm/training-engine/src/lib.rs`, run:

```bash
npm run test:engine
npm run build:engine
npm run test:wasm
```

`build:engine` compiles and copies both scalar and SIMD artifacts into `public/`. Commit the two `.wasm` files with the Rust source change. `public/physics.wasm` is a separate WAT-based showcase artifact and is rebuilt with `npm run build:wasm`.

## Troubleshooting

### Docker or Testcontainers cannot start

Start Docker Desktop and confirm `docker info` works. On Windows, ensure the Docker engine is using Linux containers. The test harness pulls `mariadb:11.4` on first use.

### Prisma cannot connect

Check `DATABASE_URL` first with `npx prisma migrate status`. If the CLI works but the app does not, verify the explicit `DATABASE_*` variables; they take precedence in the runtime adapter. Re-run `npm run db:generate` after changing `schema.prisma` or upgrading Prisma.

### WASM backend fails or falls back

Run `npm run build:engine` and confirm both training-engine artifacts exist in `public/`. A browser without SIMD support falls back to scalar; an unavailable WebGPU adapter falls back to WASM. Serve through Next.js rather than opening files directly.

### WebGPU is unavailable

Use a current Chromium-based browser, enable hardware acceleration, and inspect `chrome://gpu`. WebGPU is optional: `auto` keeps a benchmarked WASM fallback, while `?backend=webgpu` reports a recoverable error before falling back.

### Training looks different after an upgrade

Confirm the seed, topology, population size, duration, target distance, and policy version. Floating-point trajectories may differ across GPU/WASM backends; fitness ordering and normalized progress are the conformance targets, not bit-identical positions.

## Dependency security

The 2026-09-01 upgrade removed all fixable critical/high runtime findings. `npm audit` still reports upstream-only findings in Prisma 7.10's CLI configuration dependency and the MariaDB copy nested inside `@prisma/adapter-mariadb`; npm provides no compatible fix. The direct runtime `mariadb` dependency is 3.5.3. Re-check with `npm audit` on every package upgrade and do not apply the suggested Prisma 6 downgrade.
