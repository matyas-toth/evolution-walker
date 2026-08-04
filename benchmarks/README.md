# Training engine benchmarks

The baseline fixture records the observed legacy Training Hub before the worker engine was introduced. Engine comparisons use the same topology and seed, and cover population sizes 100, 500, and 2,000; generation durations 3, 10, and 30 seconds; and visible/background modes.

Run benchmarks against a production build. Record generations per second, stage timings, memory after warmup, pause acknowledgement, and main-thread interaction latency. Physical invariants and fixed-budget fitness quality are the compatibility gates; accelerated backends are not expected to reproduce identical floating-point trajectories.

The Training Hub accepts reproducible benchmark parameters in its URL, for example `?backend=wasm-simd&population=500&duration=10&seed=1831565813`. Supported backend values are `auto`, `webgpu`, `wasm-simd`, `wasm-scalar`, and `legacy`.

The Training Hub diagnostics panel exposes the measurements needed by the harness. Persisted session JSON remains the interchange format, while engine slabs remain binary and worker-local during a run.
