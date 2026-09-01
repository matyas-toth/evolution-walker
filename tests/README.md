# Test architecture

- `unit/`: deterministic physics, genetics, topology, and simulation contracts.
- `engine/`: packed CPU and shared training-backend behavior.
- `wasm/`: committed scalar/SIMD artifact ABI checks.
- `component/`: React hooks and user-facing training controls in jsdom.
- `integration/`: authenticated API and persistence behavior against disposable MariaDB.
- `e2e/`: thesis-critical browser journeys.
- `benchmark/`: hardware-dependent measurements; never a shared-runner correctness gate.

`npm run verify:fast` is Docker-free. `npm run verify` requires Docker and never uses the development database.

## Commands

- `npm run test:unit` — deterministic TypeScript algorithms, worker client, packed engine, and WASM ABI.
- `npm run test:component` — React hooks and training UI behavior in jsdom.
- `npm run test:engine` — host-native Rust engine tests.
- `npm run test:integration` — real migrations and Prisma queries in an ephemeral MariaDB 11.4 container.
- `npm run test:e2e` — isolated MariaDB plus Chromium browser journeys.
- `npm run test:coverage` — V8 HTML/LCOV reports with enforced risk-based thresholds.
- `npm run test:benchmark` — production-build backend matrix with timestamped JSON/CSV output.

The MariaDB harness creates a random mapped port and dedicated `evolution_test` database. Integration setup refuses any URL that does not contain that database name. Containers are stopped in `finally` and on termination signals; Docker Desktop must be running locally.

Benchmark dimensions can be reduced without editing code, for example:

```powershell
$env:BENCHMARK_BACKENDS = "wasm-scalar,wasm-simd"
$env:BENCHMARK_POPULATIONS = "100,500"
$env:BENCHMARK_DURATIONS = "3,10"
$env:BENCHMARK_MODES = "background"
npm run test:benchmark
```

CI runs deterministic correctness on pushes and pull requests. The scheduled job smoke-tests Chromium, Firefox, and WebKit. Real WebGPU throughput remains a hardware benchmark concern and is not used as a shared-runner correctness gate.
