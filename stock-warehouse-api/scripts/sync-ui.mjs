import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(projectRoot, "../stock-warehouse-dashboard/dist");
const destination = resolve(projectRoot, "public");
const files = ["index.html", "app.js", "styles.css", "auth.css"];

await mkdir(destination, { recursive: true });
for (const file of files) await copyFile(resolve(source, file), resolve(destination, file));
console.log(`Synced ${files.length} UI assets into ${destination}`);
