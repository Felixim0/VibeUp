import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workflow = await readFile(resolve(".github/workflows/deploy-pages.yml"), "utf8");
const requiredEntries = [
  "pages: write",
  "id-token: write",
  "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa",
  "actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
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
