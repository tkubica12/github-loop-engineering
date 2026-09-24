import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { assertCompilerStamp, compilerProbeVersion, expectedCompilerVersion } from "./workflow-version.mjs";
import { issueBody, loadBacklog, missingLabels, planSeed } from "./backlog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const command = args.shift() ?? "help";

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function loadProfile(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(id)) {
    throw new Error(`Profile id '${id}' is not a safe identifier.`);
  }
  const path = join(root, "platform", "profiles", `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(`Profile '${id}' does not exist at ${relative(root, path)}.`);
  }
  const profile = JSON.parse(readFileSync(path, "utf8"));
  if (!profile.owner || profile.owner.startsWith("REPLACE_")) {
    throw new Error(`Profile '${id}' must define a real GitHub owner before use.`);
  }
  if (profile.id !== id) {
    throw new Error(`Profile '${id}' must contain the matching id.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(profile.owner)) {
    throw new Error(`Profile '${id}' contains an invalid GitHub owner.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(profile.repositoryPrefix)) {
    throw new Error(`Profile '${id}' contains an invalid repository prefix.`);
  }
  if (profile.teams?.platform && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(profile.teams.platform)) {
    throw new Error(`Profile '${id}' contains an invalid platform team slug.`);
  }
  return profile;
}

function run(tool, toolArgs, required = true) {
  try {
    return execFileSync(tool, toolArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    if (required) {
      throw new Error(`${tool} ${toolArgs.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
    }
    return null;
  }
}

function stationName(profile, station) {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(station)) {
    throw new Error("Station must use 2-31 lowercase letters, numbers, or hyphens.");
  }
  return `${profile.repositoryPrefix}-${station}`;
}

function assertInside(parent, candidate, label) {
  const allowedRoot = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === allowedRoot || !resolvedCandidate.startsWith(`${allowedRoot}${sep}`)) {
    throw new Error(`${label} escapes ${relative(root, allowedRoot)}.`);
  }
}

function outputPath(profile, station) {
  const workshopRoot = resolve(root, ".workshop");
  const destination = resolve(workshopRoot, stationName(profile, station));
  assertInside(workshopRoot, destination, "Station path");
  return destination;
}

function replaceTokens(directory, values) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      replaceTokens(path, values);
      continue;
    }
    const original = readFileSync(path, "utf8");
    const rendered = Object.entries(values).reduce(
      (content, [key, value]) => content.replaceAll(`{{${key}}}`, value),
      original
    );
    writeFileSync(path, rendered);
  }
}

function render(profile, station, destination = outputPath(profile, station)) {
  if (existsSync(destination)) {
    throw new Error(`Station already exists at ${relative(root, destination)}. Resume there or explicitly clean up before rendering again.`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  if (lstatSync(dirname(destination)).isSymbolicLink()) {
    throw new Error("Station parent must not be a symbolic link or junction.");
  }
  cpSync(join(root, "platform", "templates", "station-repository"), destination, { recursive: true });
  replaceTokens(destination, {
    CODEOWNER: profile.teams?.platform
      ? `@${profile.owner}/${profile.teams.platform}`
      : `@${profile.owner}`,
    OWNER: profile.owner,
    REPOSITORY: stationName(profile, station),
    STATION_ID: station,
    PROFILE: profile.id
  });
  writeFileSync(join(destination, ".workshop-station.json"), `${JSON.stringify({
    owner: "github-loop-engineering/station", profile: profile.id, station
  }, null, 2)}\n`);
  run("git", ["init", "--initial-branch=main", destination]);
  run("git", ["-C", destination, "add", "."]);
  run("git", [
    "-C", destination,
    "-c", "user.name=Workshop Provisioner",
    "-c", "user.email=noreply@example.invalid",
    "commit", "-m", "Initialize workshop station"
  ]);
  return destination;
}

function printPlan(profile, station) {
  const repository = stationName(profile, station);
  console.log(JSON.stringify({
    profile: profile.id,
    target: `${profile.githubHost}/${profile.owner}/${repository}`,
    visibility: profile.visibility,
    stationMode: profile.stationMode,
    localOutput: relative(root, outputPath(profile, station)),
    remoteProvisionAllowed: profile.allowRemoteProvision,
    remoteSeedAllowed: profile.allowRemoteSeed ?? profile.allowRemoteProvision,
    remoteDeleteAllowed: profile.allowRemoteDelete,
    capabilities: profile.capabilities
  }, null, 2));
}

function verifyTree(directory) {
  const unresolved = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === ".git") continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else if (readFileSync(path, "utf8").match(/\{\{[A-Z_]+\}\}/)) {
        unresolved.push(relative(directory, path));
      }
    }
  };
  visit(directory);
  if (unresolved.length) {
    throw new Error(`Unresolved station tokens: ${unresolved.join(", ")}`);
  }
}

function help() {
  console.log(`Workshop platform commands:
  preflight --profile sandbox [--repository OWNER/REPO] [--live]
  plan      --profile sandbox --station demo01
  render    --profile sandbox --station demo01
  provision --profile sandbox --station demo01 [--apply]
  seed      --profile sandbox --station demo01 [--repository OWNER/REPO] [--offline] [--apply]
  verify    --profile sandbox [--station demo01]
  cleanup   --profile sandbox --station demo01 [--apply]

Remote provision, seed, and cleanup are plan-only unless --apply is explicit.
Seed creates only missing synthetic backlog issues; it never edits or deletes issues.`);
}

function seed(profile, station) {
  const repository = option("repository", `${profile.owner}/${stationName(profile, station)}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]+$/.test(repository)) {
    throw new Error(`Repository '${repository}' must use OWNER/REPO syntax.`);
  }
  const backlog = loadBacklog(join(root, "platform", "templates", "station-backlog.json"));
  const apply = hasFlag("apply");
  if (apply && hasFlag("offline")) {
    throw new Error("Seed cannot apply offline; the existing issues must be read first.");
  }
  if (apply && !(profile.allowRemoteSeed ?? profile.allowRemoteProvision)) {
    throw new Error(`Remote seeding is disabled by profile '${profile.id}'.`);
  }
  const [targetOwner, targetName] = repository.split("/");
  if (apply && (targetOwner !== profile.owner || targetName !== stationName(profile, station))) {
    throw new Error(`Seed applies only to ${profile.owner}/${stationName(profile, station)}, the requested station repository.`);
  }
  let existing = null;
  let labels = null;
  if (!hasFlag("offline")) {
    const issues = run("gh", ["issue", "list", "--repo", repository, "--state", "all", "--limit", "1000",
      "--json", "number,title,body"], false);
    existing = issues === null ? null : JSON.parse(issues);
    const labelList = run("gh", ["label", "list", "--repo", repository, "--limit", "1000", "--json", "name"], false);
    labels = labelList === null ? null : JSON.parse(labelList).map((label) => label.name);
  }
  console.log(`Seed target: ${profile.githubHost}/${repository} (${backlog.issues.length} synthetic backlog issues)`);
  if (existing === null) {
    console.log(hasFlag("offline")
      ? "OFFLINE existing issues not read; every item is unverified."
      : "UNKNOWN existing issues could not be read; check gh auth status and repository access.");
  }
  const actions = planSeed(backlog, existing);
  for (const action of actions) {
    if (action.action === "skip") console.log(`SKIP   #${action.number} ${action.title} (${action.reason})`);
    else if (action.action === "create") console.log(`CREATE ${action.title}`);
    else console.log(`UNVERIFIED ${action.title}`);
  }
  const labelsToCreate = labels === null ? backlog.labels : missingLabels(backlog, labels);
  for (const label of labelsToCreate) console.log(`${labels === null ? "UNVERIFIED" : "CREATE"} label ${label.name}`);
  if (!apply) {
    console.log("DRY RUN: add --apply to create missing labels and issues. Existing issues are never edited or deleted.");
    return;
  }
  if (existing === null || labels === null) {
    throw new Error(`Cannot apply: repository state for ${repository} is unknown.`);
  }
  const markerFile = run("gh", ["api", `repos/${repository}/contents/.workshop-station.json`, "--jq", ".content"], false);
  let marker = null;
  try {
    marker = markerFile === null ? null : JSON.parse(Buffer.from(markerFile, "base64").toString("utf8"));
  } catch {
    marker = null;
  }
  if (marker?.owner !== "github-loop-engineering/station" || marker.profile !== profile.id || marker.station !== station) {
    throw new Error(`Refusing seed: ${repository} has no matching .workshop-station.json ownership marker.`);
  }
  for (const label of labelsToCreate) {
    run("gh", ["label", "create", label.name, "--repo", repository, "--color", label.color,
      "--description", label.description ?? ""]);
    console.log(`CREATED label ${label.name}`);
  }
  let created = 0;
  for (const action of actions.filter((item) => item.action === "create")) {
    const issue = backlog.issues.find((item) => item.id === action.id);
    const url = run("gh", ["issue", "create", "--repo", repository, "--title", issue.title, "--body", issueBody(issue),
      ...(issue.labels ?? []).flatMap((label) => ["--label", label])]);
    console.log(`CREATED ${url}`);
    created += 1;
  }
  console.log(`PASS seed ${repository}: ${created} created, ${actions.length - created} already present.`);
}

try {
  if (command === "help") {
    help();
    process.exit(0);
  }

  const profile = loadProfile(option("profile", "sandbox"));
  const station = option("station", "demo01");

  if (command === "preflight") {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < 20) {
      throw new Error(`Node.js 20 or newer is required; found ${process.versions.node}.`);
    }
    for (const workflow of ["repository-pulse", "showcase-signal"]) {
      const path = join(root, "platform", "templates", "station-repository",
        ".github", "workflows", `${workflow}.lock.yml`);
      assertCompilerStamp(readFileSync(path, "utf8"), `${workflow}.lock.yml`);
    }
    const gitVersion = run("git", ["--version"]);
    const ghVersion = run("gh", ["--version"], hasFlag("live"));
    const ghExtensions = run("gh", ["extension", "list"], false);
    let ghAwVersion = null;
    if (ghExtensions?.includes("gh aw")) {
      const probe = spawnSync("gh", ["aw", "version"], { encoding: "utf8", shell: false, timeout: 30_000 });
      ghAwVersion = compilerProbeVersion(probe);
    }
    const copilotVersion = run("copilot", ["--version"], false);
    const openCodeVersion = run("opencode", ["--version"], false);
    if (hasFlag("live")) {
      run("gh", ["auth", "status", "--hostname", profile.githubHost]);
    }
    console.log(`PASS node ${process.versions.node}`);
    console.log(`PASS ${gitVersion}`);
    console.log(ghVersion ? `PASS ${ghVersion.split("\n")[0]}` : "SKIP GitHub CLI (required only for live operations)");
    console.log(`PASS station workflows compiled with ${expectedCompilerVersion}`);
    console.log(ghAwVersion === expectedCompilerVersion
      ? `PASS gh-aw compiler ${ghAwVersion}`
      : ghAwVersion
        ? `WARN gh-aw compiler ${ghAwVersion}; use ${expectedCompilerVersion} to recompile, or keep the compiled fallback`
        : "SKIP gh-aw extension (use the compiled workshop fallback)");
    console.log(copilotVersion ? `PASS Copilot CLI ${copilotVersion.split("\n")[0]}` : "SKIP Copilot CLI (use an enabled Copilot surface or the local reference solution)");
    console.log(openCodeVersion ? `PASS OpenCode ${openCodeVersion.split("\n")[0]}` : "SKIP OpenCode (optional alternative-harness demonstration)");
    console.log("CHECK CLI availability does not prove inference access. Prefer the built-in workflow token after a capability probe; use a scoped COPILOT_GITHUB_TOKEN fallback only with copilot-requests: write removed. Never export the gh CLI OAuth credential.");
    console.log(`PASS profile ${profile.id} -> ${profile.owner}`);
    if (hasFlag("live")) {
      const repository = option("repository", `${profile.owner}/${profile.authoringRepository}`);
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]+$/.test(repository)) {
        throw new Error(`Repository '${repository}' must use OWNER/REPO syntax.`);
      }
      const repositoryState = run("gh", ["repo", "view", repository, "--json", "nameWithOwner,isPrivate,viewerPermission"], false);
      const actionsEnabled = run("gh", ["api", `repos/${repository}/actions/permissions`, "--jq", ".enabled"], false);
      const environmentCount = run("gh", ["api", `repos/${repository}/environments`, "--jq", ".total_count"], false);
      const securityState = run("gh", ["api", `repos/${repository}`, "--jq", ".security_and_analysis // {}"], false);
      console.log(repositoryState ? `PASS repository access ${repositoryState}` : `UNKNOWN repository access ${repository}`);
      console.log(actionsEnabled === "true" ? "PASS GitHub Actions enabled" : "UNKNOWN GitHub Actions capability");
      console.log(environmentCount !== null ? `PASS environments API visible (${environmentCount})` : "UNKNOWN environments capability");
      console.log(securityState && securityState !== "{}" ? `PASS security capability metadata ${securityState}` : "UNKNOWN security products (check license and repository settings)");
      if (option("repository", null)) {
        const missingArtifacts = [];
        for (const artifact of [
          ".github/workflows/repository-pulse.md",
          ".github/workflows/showcase-signal.md",
          "data/reservation-telemetry.json",
          "package.json"
        ]) {
          const found = run("gh", ["api", `repos/${repository}/contents/${artifact}`, "--jq", ".path"], false);
          console.log(found ? `PASS prepared artifact ${found}` : `FAIL prepared artifact ${artifact}`);
          if (!found) missingArtifacts.push(artifact);
        }
        if (!repositoryState || missingArtifacts.length) {
          throw new Error(`Station repository preflight failed for ${repository}.`);
        }
      }
      console.log("CHECK cloud and partner agent policies in the GitHub agent picker; no stable repository API is assumed.");
    }
  } else if (command === "plan") {
    printPlan(profile, station);
  } else if (command === "render") {
    const destination = render(profile, station);
    verifyTree(destination);
    console.log(`Rendered ${relative(root, destination)}`);
  } else if (command === "verify") {
    const temporary = mkdtempSync(join(tmpdir(), "workshop-station-verify-"));
    try {
      const destination = render(profile, station, join(temporary, stationName(profile, station)));
      verifyTree(destination);
      run(process.execPath, [
        "--test",
        ...readdirSync(join(destination, "test")).filter((name) => name.endsWith(".test.mjs"))
          .map((name) => join(destination, "test", name))
      ]);
      console.log(`PASS rendered station ${stationName(profile, station)}`);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } else if (command === "provision") {
    printPlan(profile, station);
    if (!hasFlag("apply")) {
      console.log("PLAN ONLY: add --apply to create and push the repository.");
    } else {
      if (!profile.allowRemoteProvision) {
        throw new Error(`Remote provisioning is disabled by profile '${profile.id}'.`);
      }
      const destination = render(profile, station);
      const repository = `${profile.owner}/${stationName(profile, station)}`;
      run("gh", ["repo", "create", repository, `--${profile.visibility}`, "--source", destination, "--remote", "origin", "--push"]);
      console.log(`Created https://${profile.githubHost}/${repository}`);
    }
  } else if (command === "seed") {
    seed(profile, station);
  } else if (command === "cleanup") {
    const destination = outputPath(profile, station);
    console.log(`Local cleanup target: ${relative(root, destination)}`);
    console.log(`Remote cleanup target: ${profile.owner}/${stationName(profile, station)}`);
    if (!hasFlag("apply")) {
      console.log("PLAN ONLY: add --apply to remove the generated local station.");
    } else {
      assertInside(resolve(root, ".workshop"), destination, "Cleanup target");
      if (existsSync(destination)) {
        if (lstatSync(dirname(destination)).isSymbolicLink() || lstatSync(destination).isSymbolicLink()) {
          throw new Error("Refusing cleanup through a symbolic link or junction.");
        }
        const markerPath = join(destination, ".workshop-station.json");
        if (!existsSync(markerPath)) throw new Error("Refusing cleanup: station ownership marker is missing.");
        const marker = JSON.parse(readFileSync(markerPath, "utf8"));
        if (marker.owner !== "github-loop-engineering/station" || marker.profile !== profile.id || marker.station !== station) {
          throw new Error("Refusing cleanup: station ownership marker does not match the requested target.");
        }
      }
      rmSync(destination, { recursive: true, force: true });
      console.log("Removed generated local station. Remote repositories are never deleted by this command.");
    }
  } else {
    throw new Error(`Unknown command '${command}'.`);
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
