import { mkdir, writeFile } from "node:fs/promises";
import { loadUnifiedEvents } from "../src/adapters.js";

const outDir = "data";
const outFile = `${outDir}/events.json`;
const data = await loadUnifiedEvents();

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(data, null, 2)}\n`);

console.log(
  `Wrote ${outFile}: ${data.events.length} events from ${data.adapterStatus
    .filter((status) => status.ok)
    .map((status) => `${status.venueId}:${status.count}`)
    .join(", ")}`
);
