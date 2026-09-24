import { readFileSync } from "node:fs";

const markerPattern = /<!-- workshop-seed:([a-z0-9-]+) -->/;

export function seedMarker(id) {
  return `<!-- workshop-seed:${id} -->`;
}

export function loadBacklog(path) {
  const backlog = JSON.parse(readFileSync(path, "utf8"));
  if (backlog.version !== 1) throw new Error("Backlog seed must use version 1.");
  if (!Array.isArray(backlog.labels) || !Array.isArray(backlog.issues) || !backlog.issues.length) {
    throw new Error("Backlog seed needs labels and at least one issue.");
  }
  const labelNames = new Set();
  for (const label of backlog.labels) {
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(label.name) || !/^[0-9a-f]{6}$/.test(label.color)) {
      throw new Error(`Backlog label '${label.name}' needs a safe name and a six-digit hex color.`);
    }
    labelNames.add(label.name);
  }
  const ids = new Set();
  const titles = new Set();
  for (const issue of backlog.issues) {
    if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(issue.id) || ids.has(issue.id)) {
      throw new Error(`Backlog issue id '${issue.id}' must be unique kebab-case.`);
    }
    if (typeof issue.title !== "string" || !issue.title.startsWith("[Backlog] ") || titles.has(issue.title)) {
      throw new Error(`Backlog issue '${issue.id}' needs a unique title starting with '[Backlog] '.`);
    }
    if (typeof issue.body !== "string" || !issue.body.trim() || markerPattern.test(issue.body) || /\{\{[A-Z_]+\}\}/.test(issue.body)) {
      throw new Error(`Backlog issue '${issue.id}' needs a plain body without markers or tokens.`);
    }
    for (const label of issue.labels ?? []) {
      if (!labelNames.has(label)) throw new Error(`Backlog issue '${issue.id}' uses undeclared label '${label}'.`);
    }
    ids.add(issue.id);
    titles.add(issue.title);
  }
  return backlog;
}

export function issueBody(issue) {
  return `${issue.body}\n\n${seedMarker(issue.id)}`;
}

// existing === null means the repository state could not be read; every action is then unverified.
export function planSeed(backlog, existing) {
  const byMarker = new Map();
  const byTitle = new Map();
  for (const issue of existing ?? []) {
    const id = issue.body?.match(markerPattern)?.[1];
    if (id && !byMarker.has(id)) byMarker.set(id, issue);
    if (!byTitle.has(issue.title)) byTitle.set(issue.title, issue);
  }
  return backlog.issues.map((issue) => {
    if (existing === null) return { id: issue.id, title: issue.title, action: "unverified" };
    const found = byMarker.get(issue.id) ?? byTitle.get(issue.title);
    if (found) {
      return {
        id: issue.id,
        title: issue.title,
        action: "skip",
        number: found.number,
        reason: byMarker.has(issue.id) ? "seed marker present" : "same title already exists"
      };
    }
    return { id: issue.id, title: issue.title, action: "create" };
  });
}

export function missingLabels(backlog, existingLabelNames) {
  const present = new Set(existingLabelNames.map((name) => name.toLowerCase()));
  return backlog.labels.filter((label) => !present.has(label.name.toLowerCase()));
}
