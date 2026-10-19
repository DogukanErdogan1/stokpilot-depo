import "dotenv/config";
import { buildApp } from "./app.js";
import { createInitialAdmin } from "./auth.js";
import { db } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
try {
  await createInitialAdmin();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Yönetici hesabı oluşturulamadı.");
  db.close();
  process.exit(1);
}
const app = await buildApp();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  db.close();
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
