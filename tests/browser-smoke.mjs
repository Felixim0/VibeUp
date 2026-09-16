import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { chromium } from "/Users/Felix.Aldam-Gates/.conda/envs/vibeupOpenCode/lib/node_modules/playwright/index.mjs";
import { createBoxEntity, createEmptyProject, addEntity } from "../geometry.js";
import { createBinaryStl } from "../stl.js";
import { createZip, encodeJson } from "../archive.js";

const root = resolve(".");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathFragment = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const path = resolve(root, pathFragment);
    const pathFromRoot = relative(root, path);
    if (pathFromRoot === ".." || pathFromRoot.startsWith("../") || pathFromRoot.startsWith("..\\") || pathFromRoot === "" || !existsSync(path) || statSync(path).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
page.on("requestfailed", (request) => requests.push(`${request.url()} ${request.failure()?.errorText ?? "failed"}`));

try {
  const response = await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) {
    throw new Error(`Page request failed with ${response?.status()}.`);
  }
  await page.waitForTimeout(400);
  const markup = await page.content();
  const viewportExists = await page.locator("#viewport").count();
  if (viewportExists !== 1) {
    const bodyText = await page.locator("body").innerText();
    throw new Error(`Expected viewport markup was not retained. URL: ${page.url()} Body: ${bodyText} HTML: ${markup.slice(0, 600)} Errors: ${errors.join(" | ")} Requests: ${requests.join(" | ")}`);
  }
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({
    title: document.title,
    canvasWidth: document.querySelector("#viewport")?.width ?? 0,
    message: document.querySelector("#status-message")?.textContent ?? "",
    webgl: Boolean(document.querySelector("#viewport")?.getContext("webgl2"))
  }));
  if (!state.webgl || state.canvasWidth <= 0) {
    throw new Error(`Editor did not initialize a WebGL canvas: ${JSON.stringify(state)}`);
  }
  const activeMenu = await page.locator(".menu-button.active").textContent();
  if (activeMenu !== "Home") {
    throw new Error(`The default ribbon tab must be Home, received ${activeMenu}.`);
  }
  const defaultCursor = await page.locator("#viewport").evaluate((canvas) => canvas.style.cursor);
  if (!defaultCursor.includes("cursor-select.svg")) {
    throw new Error(`The default Select cursor was not applied: ${defaultCursor}`);
  }
  const initialDropOverlay = await page.locator("#drop-overlay").isHidden();
  if (!initialDropOverlay) {
    throw new Error("Drop overlay is visible before a file drag begins.");
  }
  await page.locator("#modal-dialog").waitFor({ state: "visible" });
  await page.locator("#modal-dialog input[type='checkbox']").check();
  await page.getByRole("button", { name: "Start modeling", exact: true }).click();
  await page.getByTitle("Detach tools into a floating palette").click();
  if (await page.locator("#floating-palette").isHidden()) {
    throw new Error("Detaching the ribbon did not open the floating palette.");
  }
  await page.locator("#attach-ribbon-button").click();
  if (!await page.locator("#floating-palette").isHidden()) {
    throw new Error("Attaching the ribbon did not close the floating palette.");
  }
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByTitle("Customize theme and editor colours").click();
  await page.locator("#modal-dialog input[type='color']").nth(3).fill("#ffcc00");
  await page.locator("#modal-dialog input[type='number']").fill("3");
  await page.getByRole("button", { name: "Apply appearance", exact: true }).click();
  const appearanceStatus = await page.locator("#status-message").textContent();
  if (!appearanceStatus?.includes("appearance")) {
    throw new Error(`Appearance settings were not applied: ${appearanceStatus}`);
  }
  await page.getByText("Home", { exact: true }).click();
  await page.getByTitle("Add a dimensioned box").first().click();
  await page.locator("#modal-dialog input").nth(0).fill("40");
  await page.locator("#modal-dialog input").nth(1).fill("30");
  await page.locator("#modal-dialog input").nth(2).fill("20");
  await page.getByRole("button", { name: "Add Box", exact: true }).click();
  await page.waitForTimeout(150);
  const modelState = await page.evaluate(() => ({
    status: document.querySelector("#status-message")?.textContent,
    selected: document.querySelector("#selection-status")?.textContent,
    outlinerRows: document.querySelectorAll(".outliner-row").length
  }));
  if (modelState.outlinerRows < 2 || !modelState.selected?.includes("Box")) {
    throw new Error(`Box interaction failed: ${JSON.stringify(modelState)}`);
  }
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByTitle("Select (Space)").click();
  const canvas = page.locator("#viewport");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error("Viewport has no layout box.");
  }
  await canvas.click({ position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.5 } });
  const selectionState = await page.locator("#selection-status").textContent();
  if (!selectionState?.includes("selected")) {
    throw new Error(`Viewport click did not select a mesh: ${selectionState}`);
  }
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.54, canvasBox.y + canvasBox.height * 0.5, { steps: 4 });
  await page.mouse.up();
  const movedStatus = await page.locator("#status-message").textContent();
  if (!movedStatus?.includes("Moved selected entity")) {
    throw new Error(`Direct viewport movement did not commit: ${movedStatus}`);
  }
  await page.getByText("Home", { exact: true }).click();
  await page.getByTitle("Move (M)").first().click();
  const moveCursor = await page.locator("#viewport").evaluate((canvas) => canvas.style.cursor);
  if (!moveCursor.includes("cursor-move.svg")) {
    throw new Error(`The Move cursor was not applied: ${moveCursor}`);
  }
  await canvas.click({ position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.5 } });
  const moveSelection = await page.locator("#selection-status").textContent();
  if (!moveSelection?.includes("selected")) {
    throw new Error(`Move tool did not select the clicked mesh: ${moveSelection}`);
  }
  await page.getByText("Home", { exact: true }).click();
  await page.getByTitle("Rotate with protractor (Q)").click();
  const rotateCursor = await page.locator("#viewport").evaluate((canvas) => canvas.style.cursor);
  if (!rotateCursor.includes("cursor-rotate.svg")) {
    throw new Error(`The Rotate cursor was not applied: ${rotateCursor}`);
  }
  await canvas.click({ position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.5 } });
  const protractorCentre = await page.locator("#status-message").textContent();
  if (!protractorCentre?.includes("Protractor centre placed")) {
    throw new Error(`Rotate tool did not place a protractor centre: ${protractorCentre}`);
  }
  await canvas.click({ position: { x: canvasBox.width * 0.56, y: canvasBox.height * 0.5 } });
  const protractorReference = await page.locator("#status-message").textContent();
  if (!protractorReference?.includes("Rotate protractor ready")) {
    throw new Error(`Rotate tool did not establish a reference: ${protractorReference}`);
  }
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + canvasBox.height * 0.43, { steps: 3 });
  const rotatePreview = await page.locator("#status-message").textContent();
  if (!rotatePreview?.includes("Rotate:")) {
    throw new Error(`Rotate tool did not preview an angle: ${rotatePreview}`);
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("[data-ribbon='home']").getByTitle("Line (L)").click();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);
  if (await page.locator("#snap-indicator").isHidden()) {
    throw new Error("Snap indicator did not appear over a model surface.");
  }
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByTitle("Switch light or dark theme").click();
  if (!await page.locator("body").evaluate((body) => body.classList.contains("theme-dark"))) {
    throw new Error("Theme toggle did not apply the dark theme.");
  }
  await page.keyboard.press("Control+N");
  if (!await page.locator("#modal-dialog").evaluate((dialog) => dialog.open)) {
    throw new Error("New project confirmation did not open.");
  }
  await page.keyboard.press("Delete");
  const modalStillOpen = await page.locator("#modal-dialog").evaluate((dialog) => dialog.open);
  const rowsDuringModal = await page.locator(".outliner-row").count();
  if (!modalStillOpen || rowsDuringModal < 2) {
    throw new Error("Editor keyboard shortcuts affected the model while a modal was open.");
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("[data-ribbon='home']").getByTitle("Line (L)").click();
  await canvas.click({ position: { x: canvasBox.width * 0.45, y: canvasBox.height * 0.55 } });
  await page.getByText("File", { exact: true }).click();
  await page.getByTitle("New project (Ctrl+N)").click();
  await page.getByRole("button", { name: "Create New", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".outliner-row").length === 0, null, { timeout: 5000 });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("[data-ribbon='home']").getByTitle("Push/Pull (P)").click();
  await page.locator("#measurements-input").fill("25");
  await page.locator("#measurements-input").press("Enter");
  const resetStatus = await page.locator("#status-message").textContent();
  const resetRows = await page.locator(".outliner-row").count();
  if (resetRows !== 0 || !resetStatus?.includes("Select an unlocked planar face")) {
    throw new Error(`New project did not clear transient drawing state: ${JSON.stringify({ resetStatus, resetRows })}`);
  }
  await page.getByText("Home", { exact: true }).click();
  await page.getByTitle("Add a dimensioned box").first().click();
  await page.locator("#modal-dialog input").nth(0).fill("20");
  await page.locator("#modal-dialog input").nth(1).fill("20");
  await page.locator("#modal-dialog input").nth(2).fill("20");
  await page.getByRole("button", { name: "Add Box", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".outliner-row").length === 1, null, { timeout: 5000 });
  const fileProject = createEmptyProject();
  addEntity(fileProject, createBoxEntity(25, 25, 25, "Loaded Box"));
  const fileArchive = createZip([{
    name: "document.json",
    data: encodeJson({
      application: "vibe-up",
      formatVersion: 1,
      project: fileProject,
      camera: { target: [0, 0, 10], yaw: -0.7, pitch: 0.5, distance: 120, projectionType: "perspective" }
    })
  }]);
  if (fileArchive.length === 0) {
    throw new Error("Project ZIP archive was empty.");
  }
  await page.locator("#project-input").setInputFiles({
    name: "browser-roundtrip.vibeup",
    mimeType: "application/zip",
    buffer: Buffer.from(fileArchive)
  });
  await page.waitForFunction(() => document.querySelector("#modal-dialog")?.open, null, { timeout: 5000 });
  await page.getByRole("button", { name: "Open Project", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#status-message")?.textContent?.includes("Opened browser-roundtrip.vibeup"), null, { timeout: 5000 });
  const openedRows = await page.locator(".outliner-row").count();
  if (openedRows !== 1) {
    throw new Error(`Project open did not replace the existing model: ${openedRows} outliner rows.`);
  }
  const stlProject = createEmptyProject();
  const stlBox = addEntity(stlProject, createBoxEntity(15, 15, 15, "STL Box"));
  const stlBlob = createBinaryStl(stlProject, [stlBox]);
  await page.locator("#stl-input").setInputFiles({
    name: "browser-import.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(await stlBlob.arrayBuffer())
  });
  await page.waitForTimeout(500);
  const imported = await page.locator("#status-message").textContent();
  if (!imported?.includes("Imported browser-import.stl")) {
    throw new Error(`STL import interaction failed: ${imported}`);
  }
  await page.getByText("File", { exact: true }).click();
  const exportInteraction = page.getByTitle("Export printable STL mesh").click();
  const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await exportInteraction;
  await page.waitForTimeout(150);
  const exportStatus = await page.locator("#status-message").textContent();
  const download = await downloadPromise;
  if (!exportStatus?.includes("Exported")) {
    throw new Error(`STL export interaction did not complete: ${exportStatus}`);
  }
  if (download && !download.suggestedFilename().endsWith(".stl")) {
    throw new Error(`STL export interaction produced ${download.suggestedFilename()}.`);
  }
  const controller = await context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 5000 });
  const cachedShell = await controller.evaluate(async () => (await caches.match("./app.js"))?.ok ?? false);
  if (!cachedShell) {
    throw new Error("Service worker did not cache the application shell.");
  }
  if (errors.length > 0 || requests.length > 0) {
    throw new Error(`Browser errors: ${errors.join(" | ")} Requests: ${requests.join(" | ")}`);
  }
  const returningPage = await context.newPage();
  await returningPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
  await returningPage.waitForTimeout(450);
  if (await returningPage.locator("#modal-dialog").evaluate((dialog) => dialog.open)) {
    throw new Error("Onboarding opt-out was not retained for the next launch.");
  }
  await returningPage.close();
  console.log(`Browser smoke test passed: ${state.title}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
