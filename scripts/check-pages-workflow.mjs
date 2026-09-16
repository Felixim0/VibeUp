import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workflow = await readFile(resolve(".github/workflows/deploy-pages.yml"), "utf8");
const requiredEntries = [
  "pages: write",
  "id-token: write",
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  "actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346",
  "include-hidden-files: true",
  "node scripts/build-pages.mjs",
  "node scripts/check-pages-artifact.mjs"
];

for (const entry of requiredEntries) {
  if (!workflow.includes(entry)) {
    throw new Error(`The GitHub Pages workflow is missing: ${entry}`);
  }
}

const floatingAction = /^\s*uses:\s*[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m;
if (floatingAction.test(workflow)) {
  throw new Error("GitHub Actions must be pinned to immutable commit SHAs.");
}

console.log("GitHub Pages workflow has the required permissions and SHA-pinned actions.");
