import "dotenv/config";
import { resetAdminPasswordFromEnvironment } from "./auth.js";
import { db } from "./db.js";

try {
  await resetAdminPasswordFromEnvironment();
  console.log("Yönetici parolası güncellendi; mevcut oturumlar kapatıldı.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Yönetici parolası güncellenemedi.");
  process.exitCode = 1;
} finally {
  db.close();
}
