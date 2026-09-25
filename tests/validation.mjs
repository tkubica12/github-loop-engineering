import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(directory, extension) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === ".git" || entry === ".workshop" || entry === ".workspace" || entry === "node_modules") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path, extension));
    } else if (!extension || extname(path) === extension) {
      files.push(path);
    }
  }
  return files;
}

function localTarget(file, value) {
  const clean = value.split("#")[0].split("?")[0];
  if (!clean || /^(https?:|mailto:|tel:|javascript:)/.test(clean)) return null;
  const target = resolve(dirname(file), decodeURIComponent(clean));
  return clean.endsWith("/") ? join(target, "index.html") : target;
}

// Raw-text elements and comments are not DOM markup, even when they contain HTML strings.
export function htmlMarkup(source) {
  return source.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");
}

export function sourceText(source) {
  return htmlMarkup(source).replace(/<wbr\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function materialFiles() {
  return [...walk(join(root, "docs"), ".html"), ...walk(join(root, "platform", "demos"), ".html")].sort();
}

export function sourceElement(source, id, ancestorClass) {
  const markup = htmlMarkup(source);
  const stack = [];
  let wanted;
  for (const match of markup.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index < 0) continue;
      const closed = stack.splice(index);
      if (wanted && closed.includes(wanted)) return markup.slice(wanted.start, match.index + match[0].length);
    } else {
      const node = { tag, start: match.index, attributes: match[0] };
      const chain = [...stack, node];
      if (match[0].match(/\bid="([^"]*)"/)?.[1] === id) {
        wanted = ancestorClass ? chain.findLast((candidate) =>
          candidate.attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/).includes(ancestorClass)) : node;
      }
      if (!/\/>$/.test(match[0]) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
        stack.push(node);
      } else if (wanted === node) return match[0];
    }
  }
  return null;
}

export function screenshotInputs(source) {
  if (/inventory(?:\.reference)?\.mjs$/.test(source)) {
    return [source, "platform/templates/station-repository/src/server.mjs",
      ...["index.html", "app.js", "app.css"].map((file) => `platform/templates/station-repository/public/${file}`)];
  }
  const path = source.split("#")[0];
  const file = join(root, ...path.split("/"));
  const markup = htmlMarkup(readFileSync(file, "utf8"));
  const runtime = [...markup.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)]
    .map((match) => localTarget(file, match[1])).filter(Boolean)
    .filter((target) => [".css", ".js"].includes(extname(target)))
    .map((target) => relative(root, target).replaceAll("\\", "/"));
  return [...new Set([path, ...runtime, "docs/assets/html-docs/tokens.css",
    "docs/assets/html-docs/appearance.js", "docs/assets/materials.js"])];
}

export function validateRepository() {
  const errors = [];
  const htmlFiles = walk(root, ".html");

  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf8");
    const markup = htmlMarkup(content);
    const label = relative(root, file);
    if (!/^<!doctype html>/i.test(content)) errors.push(`${label}: missing HTML doctype`);
    if (!/<html[^>]+lang="en"/i.test(content)) errors.push(`${label}: missing language`);
    if (!/<meta[^>]+name="viewport"/i.test(content)) errors.push(`${label}: missing viewport`);
    if (!/<title>[^<]+<\/title>/i.test(content)) errors.push(`${label}: missing title`);
    if (!/<h1[\s>]/i.test(content)) errors.push(`${label}: missing h1`);
    if (/\bTODO\b|lorem ipsum|coming soon/i.test(content)) errors.push(`${label}: editorial placeholder`);

    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    for (const id of new Set(ids)) {
      if (ids.filter((candidate) => candidate === id).length > 1) errors.push(`${label}: duplicate id '${id}'`);
    }

    for (const match of markup.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const target = localTarget(file, match[1]);
      if (target && !existsSync(target)) {
        errors.push(`${label}: broken local reference '${match[1]}'`);
      }
      const fragment = match[1].split("#")[1];
      const document = match[1].startsWith("#") ? file : target;
      if (fragment && document && existsSync(document) && extname(document) === ".html") {
        const source = htmlMarkup(readFileSync(document, "utf8"));
        const anchor = decodeURIComponent(fragment);
        if (![...source.matchAll(/\sid="([^"]+)"/g)].some((candidate) => candidate[1] === anchor)) {
          errors.push(`${label}: missing anchor '${match[1]}'`);
        }
      }
    }
    for (const match of markup.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt="[^"]+"/.test(match[0])) errors.push(`${label}: image needs useful alt text`);
      if (!/\bwidth="\d+"/.test(match[0]) || !/\bheight="\d+"/.test(match[0])) {
        errors.push(`${label}: image needs explicit dimensions`);
      }
    }
  }

  const hub = htmlMarkup(readFileSync(join(root, "docs", "index.html"), "utf8"));
  if (!hub.includes('id="ch-agenda"') || !hub.includes('id="ch-demo"') ||
      !hub.includes('data-action="toggle-slides"')) {
    errors.push("workshop hub needs an agenda, opening demonstration and slide control");
  }
  for (const [index, lab] of ["01-agentic-workflow", "02-intent-to-pr", "03-operating-model",
    "04-trusted-delivery", "05-capstone"].entries()) {
    const target = `labs/${lab}/index.html`;
    if (!hub.includes(`href="${target}"`)) errors.push(`agenda needs a direct link to Lab ${index + 1}`);
    const source = htmlMarkup(readFileSync(join(root, "docs", "labs", lab, "index.html"), "utf8"));
    if (!source.includes('data-action="toggle-slides"') || !source.includes('class="slide-content')) {
      errors.push(`Lab ${index + 1} needs reading and presentation modes in the same document`);
    }
  }

  const workflowDirectories = [
    join(root, ".github", "workflows"),
    join(root, "platform", "templates", "station-repository", ".github", "workflows"),
    join(root, "platform", "demos", "security-remediation", "workflows")
  ];
  for (const directory of workflowDirectories) {
    for (const workflow of walk(directory, ".yml")) {
      const content = readFileSync(workflow, "utf8");
      if (/pull_request_target:/.test(content)) errors.push(`${relative(root, workflow)}: privileged pull_request_target is not allowed`);
      for (const match of content.matchAll(/uses:\s*([^\s#]+)/g)) {
        if (!/@[0-9a-f]{40}$/.test(match[1])) errors.push(`${relative(root, workflow)}: action is not pinned to a full SHA: ${match[1]}`);
      }
    }
    for (const source of walk(directory, ".md")) {
      const lock = source.replace(/\.md$/, ".lock.yml");
      if (!existsSync(lock)) errors.push(`${relative(root, source)}: missing compiled lock workflow`);
    }
  }

  return { htmlCount: htmlFiles.length, errors };
}
