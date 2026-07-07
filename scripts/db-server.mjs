// Local development database: embedded PostgreSQL on port 5433.
// Production uses a managed Postgres (Supabase/Neon/Railway) via DATABASE_URL.
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, ".pgdata"),
  user: "postgres",
  password: "postgres",
  port: 5433,
  persistent: true,
});

import fs from "node:fs";
if (!fs.existsSync(path.join(root, ".pgdata", "PG_VERSION"))) {
  await pg.initialise();
  console.log("[db] initialised new data directory at .pgdata");
}

await pg.start();

const client = pg.getPgClient();
await client.connect();
const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'maxey'");
if (res.rowCount === 0) {
  await client.query("CREATE DATABASE maxey");
  console.log("[db] created database 'maxey'");
}
await client.end();

console.log("[db] PostgreSQL running on postgresql://postgres:postgres@localhost:5433/maxey");
console.log("[db] Press Ctrl+C to stop.");

const stop = async () => {
  console.log("[db] stopping...");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
