import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const crateRoot = resolve(projectRoot, "src-wasm", "training-engine")
const publicRoot = resolve(projectRoot, "public")
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo"

function build(targetDirectory, rustFlags) {
    const result = spawnSync(cargo, ["build", "--release", "--target", "wasm32-unknown-unknown"], {
        cwd: crateRoot,
        env: {
            ...process.env,
            CARGO_TARGET_DIR: resolve(crateRoot, targetDirectory),
            RUSTFLAGS: rustFlags,
        },
        stdio: "inherit",
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
}

mkdirSync(publicRoot, { recursive: true })
build("target", "-C target-feature=+bulk-memory,+mutable-globals")
copyFileSync(
    resolve(crateRoot, "target", "wasm32-unknown-unknown", "release", "training_engine.wasm"),
    resolve(publicRoot, "training-engine-scalar.wasm"),
)
build("target-simd", "-C target-feature=+simd128,+bulk-memory,+mutable-globals")
copyFileSync(
    resolve(crateRoot, "target-simd", "wasm32-unknown-unknown", "release", "training_engine.wasm"),
    resolve(publicRoot, "training-engine-simd.wasm"),
)

console.log("Built scalar and SIMD training engine artifacts in public/.")
