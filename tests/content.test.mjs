import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { htmlMarkup, materialFiles, root, sourceElement, sourceText, validateRepository } from "./validation.mjs";

test("attendee content and internal links satisfy repository standards", () => {
  const result = validateRepository();
  assert.equal(result.errors.join("\n"), "");
  assert.ok(result.htmlCount >= 8);
});

test("raw script strings and comments do not invent DOM links or duplicate IDs", () => {
  const source = '<!-- <a id="old" href="gone.html"> --><style>.x::after{content:\'id="cue"\';}</style>' +
    '<script data-doc-bootstrap>const example = \'<a id="cue" href="#absent">\';</script>' +
    '<script src="runtime.js"></script><article class="card" id="card-one"><span id="cue"></span>' +
    '<div><p>Keep the exact reading text.</p></div></article>';
  const markup = htmlMarkup(source);
  assert.deepEqual([...markup.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]), ["card-one", "cue"]);
  assert.doesNotMatch(markup, /gone\.html|#absent/);
  assert.match(markup, /src="runtime\.js"/);
  assert.match(sourceElement(source, "cue", "card"), /Keep the exact reading text/);
  assert.equal(sourceElement(source, "old"), null);
  assert.equal(sourceText("<code>2d84da4ce6cb30f84603<wbr>2e3d497c36b477eaf6c2</code>"),
    "2d84da4ce6cb30f846032e3d497c36b477eaf6c2", "Optional line breaks do not change readable identities");
});

test("the vendored html-docs kit remains canonical, including its validation and export tools", () => {
  // Canonical installed kit, validated 16 September 2026. Per-document fixes belong in the content.
  const hashes = {
    "appearance.js": "5affdf321e6e758e320b175826a24a7738bdf119396729689ccad9d9a3bcd098",
    "article.css": "64aea9a006a7343126663180688856e4652724db6f485a86ef3388d2b0acde22",
    "article.js": "0bdfd3e55d996f0af87c6e324855038f5c170125378c31fcff9f440e39cae96f",
    "bundle.js": "e3cdbe7ca1d8da92988f350bb5a1bdb9ac1f09de815c67783a3f89f081d2f575",
    "deck.css": "0fd80481261cebddb3eab3fae2a09de5502cd045157f9ccfb142f6ccc3d30709",
    "deck.js": "deeb331ba842839ac78b240d5d70ce29884f124d1bef02172e1753c3f8e60624",
    LICENSE: "bc8297b874fd3b3a571ee1d3fa6cddb453210145034ea7685a3122871c7b586b",
    "sample-diagram.svg": "b23569ce1db32e8d805c396e375c0a7f585077f6fbaab494340fc65f80c9e897",
    "slides.css": "493251a280ae8d4b2763396f194725ec23dd4b8f79648db98a62f02ecd4d612a",
    "slides.js": "a95e83fdd4e7741a3ac6c228f429955c91ade567e97dbde61d3c7f48c62c233d",
    "sync-head.js": "ab3d908db5a01ca53ea0a6c0b64ed90640c0f2ea7c62edf21edf89ad0b5241af",
    "tokens.css": "d2022012d7b514dc086ed0249101e546f6c4afae15d1311f9d04939908d7a1e1",
    "validate.js": "f094ccec6712411cdb7d7c4a663ac395a79fa820d4f6544d3923dce703f27447"
  };
  for (const [name, expected] of Object.entries(hashes)) {
    const source = readFileSync(join(root, "docs", "assets", "html-docs", name), "utf8").replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(source).digest("hex"), expected, `Canonical asset changed: ${name}`);
  }
});

test("every material uses canonical first-paint tokens, identity and presentation runtimes", () => {
  const ids = new Set();
  const canonical = (name) => readFileSync(join(root, "docs", "assets", "html-docs", name), "utf8")
    .replaceAll("\r\n", "\n").trim();
  const files = materialFiles();
  assert.equal(files.length, 24, "All 24 attendee, lab and operator materials must be covered");
  let decks = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    const markup = htmlMarkup(source);
    const label = relative(root, file);
    const id = markup.match(/<meta\b[^>]*name="doc-id"[^>]*content="([^"]+)"/)?.[1];
    assert.ok(id && !ids.has(id), `${label}: stable unique doc-id required`);
    ids.add(id);
    assert.match(markup, /<html\b[^>]*data-default-accent="blue"/, label);
    assert.doesNotMatch(markup, /data-default-theme=/, `${label}: default theme must follow the OS`);
    for (const [tag, marker, asset] of [["script", "data-doc-bootstrap", "appearance.js"], ["style", "data-doc-tokens", "tokens.css"]]) {
      const matches = [...source.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${marker}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g"))];
      assert.equal(matches.length, 1, `${label}: exactly one ${marker}`);
      assert.equal(matches[0][1].trim(), canonical(asset), `${label}: stale ${marker}; run sync-head`);
    }
    assert.match(markup, /<meta\b[^>]*name="description"[^>]*content="[^"]+"/, label);
    assert.doesNotMatch(markup, /data-theme-toggle|data-slide-(?:prev|next|counter|fullscreen|progress)|class="deck"/, label);
    assert.doesNotMatch(markup, /(?:src|href)="[^"]*assets\/(?:workshop\.js|slides\.js)"/, label);
    assert.match(markup, /<script\b[^>]*src="[^"]*assets\/materials\.js"/, label);
    const scripts = [...markup.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((match) => match[1]);
    const position = (asset) => scripts.findIndex((script) => script.endsWith(`/${asset}`));
    if (/<main\b[^>]*class="[^"]*\bdeck-stage\b/.test(markup)) {
      decks++;
      for (const asset of ["deck.css", "deck.js"]) assert.ok(markup.includes(`html-docs/${asset}`), `${label}: ${asset}`);
      assert.ok(position("materials.js") < position("deck.js"), `${label}: resolve legacy deck hashes before runtime startup`);
    } else {
      for (const asset of ["article.css", "article.js", "slides.css", "slides.js"]) {
        assert.ok(markup.includes(`html-docs/${asset}`), `${label}: ${asset}`);
      }
      for (const action of ["expand-all", "collapse-all", "toggle-slides", "toggle-theme", "toggle-accent"]) {
        assert.match(markup, new RegExp(`<button\\b[^>]*data-action="${action}"`), `${label}: ${action}`);
      }
      assert.match(markup, /<header\b[^>]*class="[^"]*\bdoc-header\b/, label);
      assert.match(markup, /class="[^"]*\btakeaway\b/, label);
      assert.match(markup, /class="[^"]*\bchapter\b/, label);
      assert.ok(position("article.js") < position("slides.js") && position("slides.js") < position("materials.js"),
        `${label}: initialize canonical reading and presentation before command/recovery helpers`);
    }
  }
  assert.equal(decks, 2);
});
