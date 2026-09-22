import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { root, screenshotInputs } from "./validation.mjs";

function decodeScreenshot(png, viewport, label) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), label);
  const data = [];
  let header;
  let ended = false;
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    assert.ok(offset + size + 12 <= png.length, `${label}: truncated PNG chunk`);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const content = png.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") header = content;
    if (type === "IDAT") data.push(content);
    offset += size + 12;
    if (type === "IEND") {
      ended = true;
      assert.equal(offset, png.length, `${label}: data after IEND`);
    }
  }
  assert.ok(header && ended && data.length, `${label}: incomplete PNG`);
  assert.equal(header.readUInt32BE(0), viewport.width, label);
  assert.equal(header.readUInt32BE(4), viewport.height, label);
  assert.equal(header[8], 8, `${label}: browser captures use 8-bit samples`);
  assert.ok([2, 6].includes(header[9]), `${label}: expected RGB or RGBA browser capture`);
  assert.deepEqual([...header.subarray(10)], [0, 0, 0], `${label}: expected standard non-interlaced PNG`);
  const channels = header[9] === 6 ? 4 : 3;
  const stride = viewport.width * channels;
  const raw = inflateSync(Buffer.concat(data));
  assert.equal(raw.length, (stride + 1) * viewport.height, `${label}: every scanline must decode`);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < viewport.height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, `${label}: invalid scanline filter`);
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      if (filter === 2) prediction = above;
      if (filter === 3) prediction = Math.floor((left + above) / 2);
      if (filter === 4) {
        const p = left + above - corner;
        const a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - corner);
        prediction = a <= b && a <= c ? left : b <= c ? above : corner;
      }
      row[x] = (row[x] + prediction) & 255;
    }
    previous = row;
  }
}

test("published screenshots identify actual browser captures and matching pharmacy source", () => {
  const directory = join(root, "docs", "assets", "screenshots");
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  assert.ok(Number.isFinite(Date.parse(manifest.capturedAt)));
  assert.ok(manifest.browser);
  assert.equal(manifest.sourceHashFormat, "sha256-utf8-lf");
  const images = new Set();
  for (const capture of manifest.captures) {
    assert.match(capture.file, /^[a-z0-9-]+\.png$/);
    assert.equal(capture.kind, "browser-capture");
    assert.ok(!images.has(capture.file), `Duplicate capture ${capture.file}`);
    images.add(capture.file);
    const png = readFileSync(join(directory, capture.file));
    decodeScreenshot(png, capture.viewport, capture.file);
    assert.ok(["light", "dark"].includes(capture.theme));
    assert.equal(capture.accent, "blue", "Published baseline filenames retain the default blue accent");
    assert.ok(capture.inputs.length >= 3);
    assert.ok(capture.inputs.some((input) => input.path === capture.source.split("#")[0]));
    assert.deepEqual(capture.inputs.map((input) => input.path).sort(), screenshotInputs(capture.source).sort(),
      `${capture.file}: bind the full current appearance/runtime source set`);
    for (const input of capture.inputs) {
      assert.match(input.path, /^(docs|platform|student|teacher)\//);
      assert.ok(!input.path.split("/").includes(".."));
      assert.equal(input.sha256, createHash("sha256").update(readFileSync(join(root, input.path), "utf8").replaceAll("\r\n", "\n")).digest("hex"),
        `${capture.file}: ${input.path} changed; rerun npm run capture`);
    }
    if (capture.file.startsWith("pharmacy-")) {
      assert.match(capture.description, /local HTTP 409/);
      for (const file of ["index.html", "app.js", "app.css"]) {
        assert.ok(capture.inputs.some((input) => input.path === `platform/templates/station-repository/public/${file}`));
      }
    } else {
      assert.ok(capture.inputs.some((input) => input.path === "docs/assets/html-docs/appearance.js"));
      assert.ok(capture.inputs.some((input) => input.path === "docs/assets/html-docs/tokens.css"));
      assert.ok(capture.inputs.some((input) => input.path === "docs/assets/materials.js"));
      if (/evidence|security-|secret-protection/.test(capture.file)) {
        assert.match(capture.description, /not (?:a screenshot of )?(?:the )?GitHub|no .*GitHub UI/i,
          "A local guide capture must not be represented as a GitHub screenshot");
      }
    }
  }
  assert.deepEqual([...images].sort(), readdirSync(directory).filter((file) => file.endsWith(".png")).sort(),
    "Every published PNG must be present in the capture manifest");
  for (const state of ["baseline", "suggestion"]) {
    for (const theme of ["light", "dark"]) assert.ok(images.has(`pharmacy-${state}-${theme}.png`));
  }
  for (const theme of ["light", "dark"]) assert.ok(images.has(`security-release-${theme}.png`));
  for (const theme of ["light", "dark"]) assert.ok(images.has(`secret-protection-${theme}.png`));
  for (const theme of ["light", "dark"]) {
    for (const name of ["full-day-guide", "full-day-slides", "showcase-slides",
      "security-remediation", "security-release", "secret-protection",
      "loop-engineering-guide", "loop-engineering-opening", "loop-engineering-closing"]) {
      assert.ok(images.has(`${name}-${theme}.png`));
    }
  }
});
