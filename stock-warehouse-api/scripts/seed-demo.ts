import "dotenv/config";
import { db } from "../src/db.js";
import { seedDemoWorkspace } from "../src/demo-data.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo verisi production ortamında bu komutla eklenemez.");
}

const account = db.prepare("SELECT workspace_id AS workspaceId FROM users ORDER BY created_at, id LIMIT 1")
  .get() as { workspaceId: string | null } | undefined;
if (!account?.workspaceId) {
  throw new Error("Örnek veri eklemeden önce uygulamayı bir kullanıcı hesabıyla başlatın.");
}

try {
  seedDemoWorkspace(account.workspaceId);
  console.log("Demo verisi kullanıcı çalışma alanına eklendi.");
} finally {
  db.close();
}
