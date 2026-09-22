import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { htmlMarkup, materialFiles, root, screenshotInputs } from "./validation.mjs";

const capture = process.argv.includes("--capture");
const output = join(root, "docs", "assets", "screenshots");
const failures = [];
const captures = [];
const paletteCaptures = [];
const option = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const pageFilter = option("--page");
assert.ok(!capture || !pageFilter, "--capture must cover every page, so it cannot replace the manifest with a partial run");
const paletteOutput = option("--palette-shots") && resolve(root, option("--palette-shots"));
assert.ok(!paletteOutput || (!relative(root, paletteOutput).startsWith("..") && !isAbsolute(relative(root, paletteOutput))),
  "Palette review artifacts must stay in the project");
const pages = materialFiles().filter((file) => !pageFilter || relative(root, file).replaceAll("\\", "/") === pageFilter.replaceAll("\\", "/"));
assert.ok(pages.length, "--page did not select a material");
const readingText = new Map();

const server = process.env.WORKSHOP_BASE_URL ? null : spawn(process.execPath, [join(root, "tests", "serve.mjs")], {
  env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
server?.stderr.on("data", (chunk) => { stderr += chunk; });
const base = process.env.WORKSHOP_BASE_URL || await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error(`Preview server exited ${code}: ${stderr}`)));
  server.stdout.on("data", (chunk) => {
    const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) resolve(match[0]);
  });
});

let browser;
function check(condition, message) {
  if (!condition) failures.push(message);
}
async function screenshot(page, name, source, theme, description) {
  if (!capture) return;
  mkdirSync(output, { recursive: true });
  captures.push(await captureImage(page, output, `${name}-${theme}.png`, source, theme, "blue", description));
}

async function captureImage(page, directory, file, source, theme, accent, description) {
  mkdirSync(directory, { recursive: true });
  const png = await page.screenshot({ path: join(directory, file), fullPage: false });
  const dimensions = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, png.toString("base64"));
  assert.deepEqual(dimensions, page.viewportSize(), `${file}: decoded screenshot dimensions`);
  return { file, source, theme, accent, description, viewport: dimensions, kind: "browser-capture",
    inputs: screenshotInputs(source).map((path) => ({
      path, sha256: createHash("sha256").update(readFileSync(join(root, ...path.split("/")), "utf8")
        .replaceAll("\r\n", "\n")).digest("hex")
    })) };
}

async function pharmacyJourney() {
  mkdirSync(join(root, ".workshop"), { recursive: true });
  const temporary = mkdtempSync(join(root, ".workshop", "workshop-browser-"));
  try {
    for (const state of ["baseline", "suggestion"]) {
      const directory = join(temporary, state);
      cpSync(join(root, "platform", "templates", "station-repository"), directory, { recursive: true });
      if (state === "suggestion") cpSync(join(root, "student", "labs", "02-intent-to-pr", "artifacts", "inventory.reference.mjs"),
        join(directory, "src", "inventory.mjs"));
      const { buildServer } = await import(pathToFileURL(join(directory, "src", "server.mjs")).href);
      const service = buildServer();
      service.listen(0, "127.0.0.1");
      await once(service, "listening");
      try {
        for (const theme of ["light", "dark"]) {
          const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce",
            viewport: { width: 1440, height: 1100 } });
          const page = await context.newPage();
          page.on("pageerror", (error) => failures.push(`Pharmacy ${state}: ${error.message}`));
          const url = `http://127.0.0.1:${service.address().port}`;
          await page.goto(url);
          await page.locator('#stock tr[data-sku="MED-004"]').waitFor();
          await page.getByRole("button", { name: "Request reservation", exact: true }).click();
          await page.locator('#result[data-status="409"]').waitFor();
          const result = await page.locator("#result").innerText();
          check(result.includes(state === "baseline" ? "No suggestion" : "Suggestion: MED-004"),
            `Pharmacy ${state}: correct unavailable-stock response`);
          check(await page.locator('#stock tr[data-sku="MED-004"] td:last-child').innerText() === "6",
            `Pharmacy ${state}: suggestion must not reserve stock`);
          const source = state === "baseline"
            ? "platform/templates/station-repository/src/inventory.mjs"
            : "student/labs/02-intent-to-pr/artifacts/inventory.reference.mjs";
          await screenshot(page, `pharmacy-${state}`, source, theme,
            "Actual local HTTP 409 response; synthetic data, not GitHub or a cloud deployment.");
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.evaluate(() => scrollTo(0, 0));
          check(await page.locator("#result").evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.top >= 0 && box.bottom <= innerHeight;
          }), `Pharmacy ${state}: the response must fit a 720p projector without scrolling`);
          await page.setViewportSize({ width: 390, height: 844 });
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `Pharmacy ${state}: mobile overflow`);
          if (state === "suggestion") {
            await page.getByRole("button", { name: "Choose MED-004", exact: true }).click();
            check(await page.locator('#stock tr[data-sku="MED-004"] td:last-child').innerText() === "6",
              "Choosing a suggestion must not create a reservation");
          }
          await context.close();
        }
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${service.address().port}`);
        await page.locator("#sku").selectOption("MED-004");
        await page.getByRole("button", { name: "Request reservation", exact: true }).click();
        await page.locator('#result[data-status="201"]').waitFor();
        await page.getByRole("cell", { name: "5", exact: true }).waitFor();
        await context.close();
        const noScript = await browser.newContext({ javaScriptEnabled: false });
        const staticPage = await noScript.newPage();
        await staticPage.goto(`http://127.0.0.1:${service.address().port}`);
        check(await staticPage.locator("#theme").isHidden(), "No-JS pharmacy: no dead theme control");
        check(await staticPage.locator("#submit").isDisabled(), "No-JS pharmacy: no misleading submit control");
        check((await staticPage.locator("#stock-status").innerText()).includes("requires JavaScript"),
          "No-JS pharmacy: explain the static stock state");
        await noScript.close();
      } finally {
        const closed = new Promise((resolve, reject) => service.close((error) => error ? reject(error) : resolve()));
        service.closeAllConnections();
        await closed;
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
const opposite = (theme) => theme === "light" ? "dark" : "light";
const palette = {
  light: { blue: "#0068bd", orange: "#a94000", green: "#137344" },
  dark: { blue: "#69b8ff", orange: "#ffae72", green: "#6cd6a0" }
};
async function frame(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
function monitor(page) {
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => failures.push(`${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) failures.push(`${page.url()}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) {
      failures.push(`Required external runtime asset: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });
}
async function appearance(page, theme, accent, label) {
  const values = await page.evaluate(() => {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    return { theme: root.dataset.theme, accent: root.dataset.accent, value: styles.getPropertyValue("--accent").trim(),
      warn: styles.getPropertyValue("--warn").trim(), scheme: styles.colorScheme };
  });
  check(values.theme === theme && values.accent === accent, `${label}: query appearance must override the opposite OS theme`);
  check(values.value.toLowerCase() === palette[theme][accent] && values.warn === values.value,
    `${label}: canonical accent and warning tokens`);
  check(values.scheme === theme, `${label}: native controls and embedded images use the selected color scheme`);
  const themeButton = page.locator('button[data-action="toggle-theme"]');
  const accentButton = page.locator('button[data-action="toggle-accent"]');
  check(await themeButton.count() === 1 && await accentButton.count() === 1, `${label}: one pair of appearance controls`);
  await themeButton.focus();
  await page.keyboard.press("Space");
  check(await page.locator("html").getAttribute("data-theme") === opposite(theme), `${label}: native Space toggles theme`);
  await themeButton.click();
  const accents = ["blue", "orange", "green"];
  for (let step = 1; step <= 3; step++) {
    await accentButton.click();
    const expected = accents[(accents.indexOf(accent) + step) % 3];
    check(await page.locator("html").getAttribute("data-accent") === expected, `${label}: accent cycle ${step}`);
    check((await accentButton.getAttribute("aria-label")).includes(`Accent: ${expected}. Switch to `),
      `${label}: accent control names current and next selection`);
  }
}
async function documentChecks(page, label) {
  check(await page.locator("h1").count() === 1, `${label}: expected one h1`);
  check(await page.locator("main").count() === 1, `${label}: expected a main landmark`);
  check(await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    return ids.length === new Set(ids).size;
  }), `${label}: unique DOM IDs`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: horizontal page overflow`);
  check(await page.locator(".loop-cycle").evaluateAll((loops) => loops.every((loop) => {
    const decision = loop.querySelector(".loop-step:has(+ .loop-return)");
    return decision && ['""', "none"].includes(getComputedStyle(decision, "::after").content);
  })), `${label}: cyclic decision must return without a dangling forward arrow`);
  for (const image of await page.locator("img").all()) {
    check(await image.evaluate(async (element) => {
      element.loading = "eager";
      try { await element.decode(); } catch { return false; }
      const width = Number(element.getAttribute("width"));
      const height = Number(element.getAttribute("height"));
      return element.alt.trim().length > 3 && width > 0 && height > 0 && element.naturalWidth > 0 &&
        element.naturalHeight > 0 && Math.abs(width / height - element.naturalWidth / element.naturalHeight) < 0.02;
    }), `${label}: image must decode with useful alt text and accurate dimensions`);
  }
}
async function openReadingAncestors(target, label) {
  for (const ancestor of await target.locator("xpath=ancestor::*").all()) {
    const kind = await ancestor.evaluate((node) => node.matches(".card") ? "card" :
      node.matches(".reveal") ? "reveal" : node.matches("details") ? "details" : null);
    if (kind === "details") {
      if (!await ancestor.evaluate((node) => node.open)) await ancestor.locator(":scope > summary").click();
    } else if (kind) {
      const toggle = ancestor.locator(kind === "card" ? ":scope > .card-head > .card-toggle" : ":scope > .reveal-toggle");
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      check(await toggle.getAttribute("aria-expanded") === "true", `${label}: ${kind} ancestor opens through its control`);
    }
  }
}
async function expandReadingDepth(page, label) {
  for (const node of await page.locator(".card-body .reveal, .card-body details").all()) {
    await openReadingAncestors(node, label);
    if (await node.evaluate((element) => element.matches("details"))) {
      if (!await node.evaluate((element) => element.open)) await node.locator(":scope > summary").click();
    } else {
      const toggle = node.locator(":scope > .reveal-toggle");
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      check(await node.locator(":scope > .reveal-body").isVisible(), `${label}: expanded depth is readable`);
    }
  }
}
async function articleChecks(page, path, label) {
  const cards = page.locator("main > .chapter > .card");
  check(await cards.count() > 0 && await cards.count() === await page.locator(".card").count(),
    `${label}: every card belongs directly to a chapter`);
  readingText.set(path, await page.locator(".card-body").allTextContents());
  await page.locator('[data-action="expand-all"]').click();
  check(await page.locator(".card[data-open]").count() === await cards.count(), `${label}: expand all cards`);
  const command = page.locator(".code").filter({ has: page.locator("[data-copy-command]") }).first();
  if (await command.count()) {
    const button = command.locator("[data-copy-command]").first();
    await openReadingAncestors(button, label);
    check(await button.isVisible(), `${label}: reveal the command before copying`);
    check(await button.evaluate((node) => node.classList.contains("ctrl") &&
      (node.matches('button[type="button"]') || node.matches('input[type="button"]'))),
    `${label}: copy commands remain native canonical controls`);
    await page.evaluate(() => {
      window.__copiedCommand = null;
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { writeText: async (text) => { window.__copiedCommand = text; } } });
    });
    await button.click();
    const expected = await command.locator("pre").first().textContent();
    check(await page.evaluate(() => window.__copiedCommand) === expected, `${label}: copy preserves exact command text`);
  }
  for (const reveal of await page.locator(".card-body .reveal").first().all()) {
    const button = reveal.locator(":scope > .reveal-toggle");
    await openReadingAncestors(reveal, label);
    const open = await reveal.getAttribute("data-open") !== null;
    if (open) await button.click();
    await button.click();
    check(await reveal.locator(":scope > .reveal-body").isVisible(), `${label}: closed reading reveal opens`);
    check(await button.getAttribute("aria-expanded") === "true", `${label}: open reveal ARIA state`);
    await button.click();
    check(await reveal.locator(":scope > .reveal-body").isHidden(), `${label}: reading reveal closes`);
    check(await button.getAttribute("aria-expanded") === "false", `${label}: closed reveal ARIA state`);
    if (open) await button.click();
  }
  await expandReadingDepth(page, label);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: expanded recovery/extension overflow`);
  await page.setViewportSize({ width: 720, height: 500 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: expanded reading content reflows at an effective 200% desktop zoom`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="collapse-all"]').click();
  check(await page.locator(".card[data-open]").count() === 0, `${label}: collapse all cards`);
  check(await cards.evaluateAll((nodes) => nodes.every((card) =>
    (card.querySelector(".card-toggle").getAttribute("aria-expanded") === "true") === card.hasAttribute("data-open"))),
  `${label}: card visibility and ARIA agree`);
  const first = cards.first();
  const id = await first.getAttribute("id");
  await page.evaluate((hash) => { location.hash = hash; }, id);
  await frame(page);
  check(await first.getAttribute("data-open") !== null && await first.locator(":scope > .card-body").isVisible(),
    `${label}: card hash exposes reading content`);
}
async function deepLink(page, url, id, label) {
  await page.goto(`${url}#${id}`, { waitUntil: "load" });
  const target = page.locator(`[id="${id}"]`);
  check(await target.count() === 1, `${label}: retained anchor ${id}`);
  check(await target.evaluate((element) => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (parent.matches(".card, .reveal") && !parent.hasAttribute("data-open")) return false;
      if (parent.matches("details") && !parent.open) return false;
    }
    const content = element.closest(".card")?.querySelector(".card-body") || element;
    return content.getClientRects().length > 0;
  }), `${label}: ${id} reveals all reading ancestors`);
  await target.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await frame(page);
}
async function readingCaptures(page, path, url, theme) {
  const capturesByPath = {
    "docs/guides/full-day.html": [["full-day-guide", "", "Full-day guide in a local browser."]],
    "docs/guides/loop-engineering.html": [["loop-engineering-guide", "", "Local guide to bounded loop decisions; not a live agent dashboard."]],
    "docs/guides/security-remediation.html": [
      ["security-remediation", "review", "Local guide view of a real CodeQL finding, human review, merge and fixed alert; not GitHub UI."],
      ["security-release", "release", "Guide view of the recorded reviewed package, human environment approval and Azure runtime; not GitHub UI."]],
    "docs/guides/secret-protection.html": [["secret-protection", "evidence", "Guide view of native GitHub REST push protection and its clean control; no credential values or GitHub UI."]]
  };
  for (const [name, id, description] of capturesByPath[path] || []) {
    if (id) await deepLink(page, url, id, path);
    else await page.goto(url, { waitUntil: "load" });
    await screenshot(page, name, `${path}${id ? `#${id}` : ""}`, theme, description);
  }
}
async function presentation(page, path, url, isDeck, theme, accent, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "load" });
  if (!isDeck) await page.locator('[data-action="toggle-slides"]').click();
  const selector = isDeck ? ".slide[data-current]" : "[data-slide-current]";
  const current = () => page.locator(selector);
  const expected = await page.evaluate((deck) => {
    if (deck) return [...document.querySelectorAll(".deck-stage > .slide")].map((node) => node.id);
    const slides = [document.querySelector(".doc-header")];
    document.querySelectorAll("main > .chapter").forEach((chapter) => {
      slides.push(chapter, ...chapter.querySelectorAll(":scope > .card"));
    });
    slides.push(document.querySelector(".takeaway"));
    return slides.map((node) => node.id);
  }, isDeck);
  const label = `${path} ${theme}/${accent} ${viewport.width}x${viewport.height}`;
  check(expected.length > 2, `${label}: complete presentation narrative`);
  await current().focus();
  await page.keyboard.press("Home");
  const progress = page.locator(isDeck ? ".deck-progress" : ".slide-progress");
  check(await progress.getAttribute("aria-live") === "polite" &&
    await page.locator("main").getAttribute("aria-live") === null, `${label}: only concise progress is a live region`);
  const reviewPage = Boolean(pageFilter) || isDeck || path === "docs/guides/loop-engineering.html" ||
    path.endsWith("/control-room.html");
  // validate:html owns exhaustive authored-surface budgets, density and traversal.
  // These samples exercise the workshop integration and produce actual review images.
  const special = await page.evaluate(({ ids, deck }) => {
    const panels = ids.map((id) => {
      const node = document.getElementById(id);
      return deck ? node : node.querySelector(":scope > .slide-content, :scope > .chapter-label");
    });
    const diagram = panels.findIndex((panel) => panel.querySelector("svg, img, .loop, .flow, .diagram"));
    const sizes = panels.map((panel) => panel.textContent.trim().split(/\s+/).length);
    return { diagram, busiest: sizes.indexOf(Math.max(...sizes)) };
  }, { ids: expected, deck: isDeck });
  const samples = [...new Set([0, 1, 2, expected.length - 1, special.diagram, special.busiest])]
    .filter((index) => index >= 0).sort((left, right) => left - right);
  for (const index of samples) {
    const id = expected[index];
    if (index < 3) {
      if (index > 0) await page.keyboard.press("PageDown");
    } else await page.evaluate((hash) => { location.hash = hash; }, id);
    await frame(page);
    check(await current().count() === 1 && await current().getAttribute("id") === id, `${label}: narrative order ${id}`);
    const panel = isDeck ? current() : current().locator(":scope > .slide-content, :scope > .chapter-label");
    check((await panel.getAttribute("aria-label"))?.startsWith(`${index + 1} of ${expected.length}: `),
      `${label}: focused slide announces position and title`);
    check(await panel.getAttribute("aria-roledescription") === "slide", `${label}: accessible slide semantics`);
    if (isDeck) {
      check(await current().locator(`[id="slide-${index + 1}"]`).count() === 1, `${label}: stable legacy slide alias`);
      if (accent === "blue" && viewport.width === 1920) {
        if (index === 1) await screenshot(page, path.includes("full-day") ? "full-day-slides" : "showcase-slides",
          `${path}#slide-${index + 1}`, theme, "Presentation slide at the target projector resolution.");
        if (path.includes("full-day") && (index === 0 || index === expected.length - 1)) {
          await screenshot(page, index === 0 ? "loop-engineering-opening" : "loop-engineering-closing",
            `${path}#slide-${index + 1}`, theme, "Loop Engineering full-day speaking aid at projector resolution.");
        }
      }
    } else {
      check(await page.locator(".card-toggle:visible, .card-body:visible").count() === 0,
        `${label}: reading prose and controls stay off presentation surfaces`);
    }
    check(await panel.locator('.frag[aria-hidden="true"]').count() === 0, `${label}: reduced-motion points are accessible`);
    if (paletteOutput && reviewPage && viewport.width !== 1280) {
      const surfaces = [["opening", 0], ["closing", expected.length - 1], ["diagram", special.diagram], ["busiest", special.busiest]]
        .filter(([, candidate]) => candidate === index);
      for (const [surface] of surfaces) {
        const name = `${path.replace(/\.html$/, "").replaceAll("/", "-")}-${theme}-${accent}-${viewport.width}x${viewport.height}-${surface}.png`;
        paletteCaptures.push(await captureImage(page, paletteOutput, name, `${path}#${id}`, theme, accent,
          `Actual local browser ${surface}; palette composition review, not GitHub platform proof.`));
      }
    }
  }
  await page.keyboard.press("Home");
  for (const key of isDeck ? ["ArrowRight", "ArrowDown", "Space", "PageDown"] : ["ArrowRight", "Space", "PageDown"]) {
    await page.keyboard.press(key);
  }
  check(await current().getAttribute("id") === expected[isDeck ? 4 : 3], `${label}: forward keyboard navigation`);
  for (const key of isDeck ? ["ArrowLeft", "ArrowUp", "PageUp"] : ["ArrowLeft", "PageUp"]) await page.keyboard.press(key);
  check(await current().getAttribute("id") === expected[1], `${label}: reverse keyboard navigation`);
  await page.keyboard.press("End");
  check(await current().getAttribute("id") === expected.at(-1), `${label}: End navigation`);
  await page.keyboard.press("o");
  const dialog = page.getByRole("dialog", { name: "Slide index" });
  check(await dialog.isVisible(), `${label}: named slide index`);
  check(await dialog.locator('[data-go][aria-current="true"]').count() === 1, `${label}: index identifies current slide`);
  check(await dialog.locator("[data-go]").count() === expected.length, `${label}: every slide in index`);
  await dialog.locator('[data-go="1"]').click();
  check(await current().getAttribute("id") === expected[1], `${label}: index selection`);
  await page.keyboard.press("o");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((selector) => {
    const active = document.activeElement;
    const slide = document.querySelector(selector);
    return active === slide || slide.contains(active);
  }, selector, { timeout: 8000 });
  check(await current().getAttribute("id") === expected[1], `${label}: index restores focus without changing the slide`);
  await page.keyboard.press("Home");
  await page.locator(isDeck ? '[data-deck="next"]' : '[data-slide="next"]').click();
  await page.keyboard.press("PageDown");
  check(await current().getAttribute("id") === expected[2], `${label}: presenter remote works after clicking Next`);
  await page.keyboard.press("Home");
  check(await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return !event.defaultPrevented && !document.fullscreenElement;
  }), `${label}: browser shortcuts remain available`);
  await (isDeck ? current().locator(".slide-title, h1, h2").first() :
    current().locator(":scope > .slide-content .slide-title")).click();
  check(await current().getAttribute("id") === expected[1], `${label}: click navigation`);
  await page.keyboard.press("Home");
  await page.locator('[data-action="toggle-theme"]').focus();
  await page.keyboard.press("Space");
  check(await current().getAttribute("id") === expected[0], `${label}: Space on a native button does not advance`);
  check(await page.locator("html").getAttribute("data-theme") === opposite(theme), `${label}: theme keyboard toggle in slides`);
  await page.locator('[data-action="toggle-theme"]').click();
  const activeId = await current().getAttribute("id");
  await page.locator('[data-action="toggle-accent"]').click();
  const nextAccent = ["blue", "orange", "green"][(["blue", "orange", "green"].indexOf(accent) + 1) % 3];
  check(await page.locator("html").getAttribute("data-accent") === nextAccent &&
    await current().getAttribute("id") === activeId, `${label}: accent control changes the same presentation without advancing`);
  await page.locator('[data-action="toggle-accent"]').click();
  await page.locator('[data-action="toggle-accent"]').click();
  await current().focus();
  const animation = page.locator(isDeck ? '[data-deck="reveal"]' : '[data-action="toggle-animations"]');
  check(await animation.isDisabled(), `${label}: reduced motion disables animation control`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await frame(page);
  await animation.click();
  check(await animation.getAttribute("aria-pressed") === "false", `${label}: animations can be turned off`);
  await current().focus();
  await page.keyboard.press("ArrowRight");
  check(await current().getAttribute("id") === expected[1], `${label}: animations off advances a whole slide`);
  await animation.click();
  check(await animation.getAttribute("aria-pressed") === "true", `${label}: animations can be restored`);
  const fragmented = await page.evaluate((deck) => {
    const fragment = document.querySelector(deck ? ".deck-stage > .slide .frag" : ".slide-content .frag");
    return fragment?.closest(deck ? ".slide" : ".card, .doc-header, .takeaway")?.id;
  }, isDeck);
  if (fragmented) {
    await page.evaluate((id) => { location.hash = id; }, fragmented);
    await frame(page);
    await current().focus();
    await page.keyboard.press("ArrowRight");
    check(await current().getAttribute("id") === fragmented &&
      await current().locator('.frag[aria-hidden="false"]').count() === 1, `${label}: reveal one accessible fragment without skipping`);
    const fragmentIndex = expected.indexOf(fragmented);
    if (fragmentIndex < expected.length - 1) {
      await page.keyboard.press("PageDown");
      check(await current().getAttribute("id") === expected[fragmentIndex + 1], `${label}: PageDown skips remaining fragments`);
      await page.keyboard.press("PageUp");
      check(await current().getAttribute("id") === fragmented &&
        await current().locator('.frag[aria-hidden="true"]').count() === 0, `${label}: PageUp exposes complete previous slide`);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await frame(page);
  check(await animation.isDisabled() && await current().locator('.frag[aria-hidden="true"]').count() === 0,
    `${label}: changing reduced motion reveals remaining points immediately`);
  await page.keyboard.press("Home");
  const swipe = async (from, to) => current().evaluate((node, points) => {
    for (const [type, clientX] of [["touchstart", points.from], ["touchend", points.to]]) {
      node.dispatchEvent(new TouchEvent(type, { bubbles: true,
        changedTouches: [new Touch({ identifier: 1, target: node, clientX })] }));
    }
  }, { from, to });
  await swipe(240, 140);
  check(await current().getAttribute("id") === expected[1], `${label}: horizontal swipe advances`);
  await swipe(140, 240);
  check(await current().getAttribute("id") === expected[0], `${label}: reverse swipe returns`);
  if (isDeck) {
    for (let index = 0; index < expected.length; index++) {
      await page.goto(`${url}#slide-${index + 1}`, { waitUntil: "domcontentloaded" });
      check(await current().getAttribute("id") === expected[index], `${label}: legacy URL slide-${index + 1}`);
      check(await current().evaluate((slide) => slide.scrollHeight <= slide.clientHeight + 1 &&
        slide.scrollWidth <= slide.clientWidth + 1), `${label}: legacy target slide-${index + 1} clips`);
    }
  } else {
    const cardId = await page.locator(".card").first().getAttribute("id");
    await page.goto(`${url}&view=slides#${cardId}`, { waitUntil: "load" });
    check(await current().getAttribute("id") === cardId, `${label}: ?view=slides deep link selects authored card`);
    await page.keyboard.press("Escape");
    check(await page.locator("html").getAttribute("data-view") === null &&
      !new URL(page.url()).searchParams.has("view"), `${label}: Escape exits slides and updates URL`);
    check(await page.locator(`[id="${cardId}"] > .card-body`).isVisible(), `${label}: exit exposes current reading card`);
    await page.locator('[data-action="toggle-slides"]').click();
    await page.locator('[data-action="toggle-slides"]').click();
    check(await page.locator("html").getAttribute("data-view") === null, `${label}: Slides control exits presentation`);
  }
}

async function preferenceChecks() {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce" });
    const page = await context.newPage();
    monitor(page);
    for (const file of pages) {
      const path = relative(root, file).replaceAll("\\", "/");
      const url = `${base}/${path}`;
      await page.goto(url, { waitUntil: "load" });
      const id = await page.locator('meta[name="doc-id"]').getAttribute("content");
      check(await page.locator("html").getAttribute("data-theme") === theme &&
        await page.locator("html").getAttribute("data-accent") === "blue", `${path}: document isolation and OS default`);
      await page.locator('[data-action="toggle-theme"]').click();
      await page.locator('[data-action="toggle-accent"]').click();
      await page.reload({ waitUntil: "load" });
      check(await page.locator("html").getAttribute("data-theme") === opposite(theme) &&
        await page.locator("html").getAttribute("data-accent") === "orange", `${path}: reload persists document choices`);
      check(await page.evaluate((docId) => localStorage.getItem(`html-docs:${docId}:accent`), id) === "orange",
        `${path}: canonical document-scoped storage key`);
      await page.goto(`${url}?theme=${theme}&accent=green`, { waitUntil: "load" });
      check(await page.locator("html").getAttribute("data-theme") === theme &&
        await page.locator("html").getAttribute("data-accent") === "green", `${path}: query overrides stored preferences`);
      await page.locator('[data-action="toggle-theme"]').click();
      await page.locator('[data-action="toggle-accent"]').click();
      await page.reload({ waitUntil: "load" });
      check(new URL(page.url()).searchParams.get("theme") === opposite(theme) &&
        new URL(page.url()).searchParams.get("accent") === "blue", `${path}: toggles update query overrides`);
      await page.locator('[data-action="toggle-accent"]').click();
    }
    await context.close();
  }
  const context = await browser.newContext({ colorScheme: "dark", reducedMotion: "reduce" });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage disabled by policy", "SecurityError"); } });
  });
  const page = await context.newPage();
  monitor(page);
  for (const file of pages) {
    const path = relative(root, file).replaceAll("\\", "/");
    await page.goto(`${base}/${path}?theme=light&accent=green`, { waitUntil: "load" });
    await appearance(page, "light", "green", `${path}: storage unavailable`);
  }
  await context.close();
}
async function noScriptChecks() {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: theme });
    const page = await context.newPage();
    monitor(page);
    for (const file of pages) {
      const path = relative(root, file).replaceAll("\\", "/");
      await page.goto(`${base}/${path}?view=slides`, { waitUntil: "load" });
      const article = await page.locator(".doc").count() > 0;
      for (const details of await page.locator("details").all()) {
        if (!await details.evaluate((node) => node.open)) await details.locator(":scope > summary").click();
        check(await details.evaluate((node) => node.open), `${path}: native recovery details work without JavaScript`);
      }
      const reference = page.locator(article ? ".card-body, .reveal-body, .detail-body, .tabpanel" : ".slide");
      check(await reference.count() > 0, `${path}: no-JS reading reference exists`);
      for (const node of await reference.all()) check(await node.isVisible(), `${path}: no-JS reference body visible`);
      if (article) {
        check(JSON.stringify(await page.locator(".card-body").allTextContents()) === JSON.stringify(readingText.get(path)),
          `${path}: full no-JS reading-text parity`);
        check(await page.locator(".slide-content:visible").count() === 0, `${path}: no duplicate presentation summaries without JavaScript`);
      }
      check(await page.locator('[data-action]:visible, [data-deck]:visible').count() === 0, `${path}: no dead no-JS controls`);
      await documentChecks(page, `${path} no-JS ${theme}`);
    }
    await context.close();
  }
}

try {
  assert.equal((await fetch(`${base}/docs/`, { signal: AbortSignal.timeout(5000) })).status, 200);
  browser = process.env.BROWSER_ENDPOINT ? await chromium.connectOverCDP(process.env.BROWSER_ENDPOINT) :
    await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  for (const theme of ["light", "dark"]) for (const accent of ["blue", "orange", "green"]) {
    const context = await browser.newContext({ colorScheme: opposite(theme), reducedMotion: "reduce" });
    const page = await context.newPage();
    monitor(page);
    for (const file of pages) {
      const path = relative(root, file).replaceAll("\\", "/");
      const isDeck = /class="[^"]*\bdeck-stage\b/.test(htmlMarkup(readFileSync(file, "utf8")));
      const url = `${base}/${path}?theme=${theme}&accent=${accent}`;
      console.log(`BROWSER ${theme}/${accent} ${path}`);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(url, { waitUntil: "load" });
      await appearance(page, theme, accent, path);
      await documentChecks(page, `${path} ${theme}/${accent}`);
      if (!isDeck) {
        await articleChecks(page, path, `${path} ${theme}/${accent} 1440`);
        if (accent === "blue") await readingCaptures(page, path, url, theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(url, { waitUntil: "load" });
        await page.locator('[data-action="expand-all"]').click();
        await expandReadingDepth(page, `${path} mobile`);
        await documentChecks(page, `${path} ${theme}/${accent} mobile expanded`);
        if (path === "docs/guides/full-day.html") await deepLink(page, url, "recovery", path);
        if (path.endsWith("/control-room.html")) {
          check(await page.locator(".card").count() === 8, `${path}: eight simulation cards`);
          for (let scene = 1; scene <= 8; scene++) await deepLink(page, url, `scene-${scene}`, path);
        }
      }
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 },
        ...(isDeck ? [{ width: 1280, height: 720 }] : [])]) {
        await presentation(page, path, url, isDeck, theme, accent, viewport);
      }
    }
    await context.close();
  }
  await preferenceChecks();
  await noScriptChecks();
  if (!pageFilter) await pharmacyJourney();
  assert.deepEqual(failures, [], `Browser defects:\n${failures.join("\n")}`);
  const manifest = (records) => `${JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(),
    sourceHashFormat: "sha256-utf8-lf", captures: records }, null, 2)}\n`;
  if (capture) writeFileSync(join(output, "manifest.json"), manifest(captures));
  if (paletteOutput) writeFileSync(join(paletteOutput, "manifest.json"), manifest(paletteCaptures));
  console.log(`PASS ${pages.length} materials; six palettes, opposite OS, responsive layouts, presentation order, preferences and no-JS`);
  if (capture) console.log(`CAPTURE ${captures.length} source-bound browser screenshots in docs/assets/screenshots`);
  if (paletteOutput) console.log(`REVIEW ${paletteCaptures.length} source-bound palette screenshots in ${relative(root, paletteOutput)}`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const closed = once(server, "exit");
    server.kill();
    await closed;
  }
}
