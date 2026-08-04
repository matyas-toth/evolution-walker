# Rust training engine

This crate owns the hot training loop behind a raw `f32` buffer ABI. Topology is compiled once, population slabs remain allocated across generations, oscillators use a recurrence rather than host `Math.sin` imports, and genomes are materialized as JSON only at the application boundary.

`npm run build:engine` builds pinned scalar and SIMD artifacts into `public/`. Ordinary Next.js builds consume the committed artifacts and do not require Rust on the deployment machine. The two builds intentionally share the same ABI so the coordinator can fall back without changing session data.

The engine favors throughput and invariant-compatible fitness over bit-identical trajectories with the legacy JavaScript simulator. Editor, replay, and showcase physics remain on the existing implementation until the training engine has completed cross-backend quality validation.
