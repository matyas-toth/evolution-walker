import { spawn } from "node:child_process"
import { GenericContainer, Wait } from "testcontainers"

const TEST_DATABASE = "evolution_test"
const TEST_USER = "evolution_test"
const TEST_PASSWORD = "evolution_test_password"

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" && !command.endsWith(".cmd") ? `${command}.cmd` : command
    const child = spawn(executable, args, {
      env: environment,
      stdio: "inherit",
      shell: process.platform === "win32",
    })
    child.once("error", reject)
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

const requestedCommand = process.argv[2]
const requestedArguments = process.argv.slice(3)
if (!requestedCommand) {
  throw new Error("Usage: node scripts/run-with-test-database.mjs <command> [...args]")
}

let container
let stopping = false
let phase = "starting the MariaDB container"

async function stopContainer() {
  if (stopping || !container) return
  stopping = true
  await container.stop()
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopContainer()
    process.exit(1)
  })
}

try {
  container = await new GenericContainer("mariadb:11.4")
    .withEnvironment({
      MARIADB_DATABASE: TEST_DATABASE,
      MARIADB_USER: TEST_USER,
      MARIADB_PASSWORD: TEST_PASSWORD,
      MARIADB_ROOT_PASSWORD: "root_test_password",
    })
    .withExposedPorts(3306)
    // The image reports readiness once for its temporary initialization server,
    // shuts that server down, and then reports readiness for the real server.
    .withWaitStrategy(Wait.forLogMessage(/ready for connections/i, 2))
    .withStartupTimeout(120_000)
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(3306)
  const databaseUrl = `mysql://${TEST_USER}:${TEST_PASSWORD}@${host}:${port}/${TEST_DATABASE}`
  if (!databaseUrl.includes(TEST_DATABASE)) throw new Error("Refusing to use a non-test database")

  const environment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    AUTH_SECRET: "integration-test-secret-that-is-never-used-in-production",
    AUTH_URL: "http://127.0.0.1:3100",
  }

  phase = "applying Prisma migrations"
  await run("npx", ["prisma", "migrate", "deploy"], environment)
  phase = `running ${requestedCommand}`
  await run(requestedCommand, requestedArguments, environment)
} catch (error) {
  if (!container) {
    console.error("Could not start the disposable MariaDB test environment. Ensure Docker Desktop or another Docker-compatible runtime is running.")
  } else {
    console.error(`Disposable MariaDB test environment failed while ${phase}.`)
  }
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
} finally {
  await stopContainer()
}
