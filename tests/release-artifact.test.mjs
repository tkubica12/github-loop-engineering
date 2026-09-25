import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { inspectReleaseArtifact, inspectReleasePackage } from "../platform/demos/security-remediation/scripts/release-artifact.mjs";

const manifest = { commit: "1".repeat(40), prHead: "2".repeat(40), workflowSha: "3".repeat(40),
  runId: "42", sourceRepo: "example/pharmacy", prNumber: 2 };
function artifact(options = {}) {
  const payload = options.payload ?? zipSync({
    "src/server.mjs": strToU8("// synthetic test"),
    "package.json": strToU8("{}"), "data/stock.json": strToU8("{}"),
    "release-manifest.json": strToU8(JSON.stringify(options.manifest ?? manifest))
  });
  const sha = options.digest ?? createHash("sha256").update(payload).digest("hex");
  return zipSync({ "release.zip": payload, "release.zip.sha256": strToU8(`${sha}  release.zip\n`) });
}

function entries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString();
    const local = view.getUint32(offset + 42, true);
    result.push({ name, central: offset, local });
  }
  return result;
}

function forgeDeclaredSize(bytes, name, size) {
  const forged = Uint8Array.from(bytes);
  const view = new DataView(forged.buffer);
  const entry = entries(forged).find((candidate) => candidate.name === name);
  assert.ok(entry);
  view.setUint32(entry.central + 24, size, true);
  view.setUint32(entry.local + 22, size, true);
  return forged;
}

function corruptCrc(bytes, name) {
  const corrupted = Uint8Array.from(bytes);
  const view = new DataView(corrupted.buffer);
  const entry = entries(corrupted).find((candidate) => candidate.name === name);
  assert.ok(entry);
  view.setUint32(entry.central + 16, (view.getUint32(entry.central + 16, true) ^ 1) >>> 0, true);
  view.setUint32(entry.local + 14, (view.getUint32(entry.local + 14, true) ^ 1) >>> 0, true);
  return corrupted;
}
test("the artifact proves distinct workflow and reviewed application identities from actual ZIP bytes", () => {
  assert.deepEqual(inspectReleaseArtifact(artifact()).manifest, manifest);
  assert.notEqual(manifest.commit, manifest.workflowSha);
});
test("artifact inspection rejects checksum, manifest and expansion-limit violations", () => {
  assert.throws(() => inspectReleaseArtifact(artifact({ digest: "0".repeat(64) })), /checksum mismatch/);
  assert.throws(() => inspectReleaseArtifact(artifact({ manifest: { ...manifest, commit: "latest" } })));
  const bomb = zipSync({ "huge.txt": new Uint8Array(100_000) });
  assert.ok(bomb.length < 1000);
  assert.throws(() => inspectReleaseArtifact(bomb, 1000), /expanded size/);
  assert.throws(() => inspectReleaseArtifact(zipSync({ "../escape": strToU8("x") })), /Unsafe archive/);
});

test("actual emitted size prevents an understated source entry from hashing only its approved prefix", () => {
  const approved = "// approved\n".padEnd(3100, "a");
  const suffix = "\nexecuteUnreviewedBehavior();".padEnd(46, "!");
  const payload = zipSync({
    "src/server.mjs": strToU8(approved + suffix),
    "package.json": strToU8("{}"),
    "data/stock.json": strToU8("{}"),
    "release-manifest.json": strToU8(JSON.stringify(manifest))
  });
  const forged = forgeDeclaredSize(payload, "src/server.mjs", strToU8(approved).length);
  assert.throws(() => inspectReleaseArtifact(artifact({ payload: forged })),
    /ZIP expanded size mismatch: src\/server\.mjs/);
});

test("entry CRC is verified before release source blobs are trusted", () => {
  const payload = zipSync({
    "src/server.mjs": strToU8("// synthetic test"),
    "package.json": strToU8("{}"),
    "data/stock.json": strToU8("{}"),
    "release-manifest.json": strToU8(JSON.stringify(manifest))
  });
  assert.throws(() => inspectReleaseArtifact(artifact({ payload: corruptCrc(payload, "src/server.mjs") })),
    /ZIP CRC mismatch: src\/server\.mjs/);
});

test("actual expansion is bounded even when a bomb understates its declared size", () => {
  const payload = zipSync({
    "huge.txt": new Uint8Array(100_000),
    "src/server.mjs": strToU8("// synthetic test"),
    "package.json": strToU8("{}"),
    "data/stock.json": strToU8("{}"),
    "release-manifest.json": strToU8(JSON.stringify(manifest))
  });
  const forged = forgeDeclaredSize(payload, "huge.txt", 1);
  assert.ok(forged.length < 10_000);
  assert.throws(() => inspectReleasePackage(forged, 10_000), /configured expanded size/);
});

test("real Python ZIPs and their normal data descriptors remain supported", (t) => {
  const script = String.raw`
import hashlib, io, json, sys, zipfile
class NonSeekable(io.BytesIO):
    def seekable(self): return False
    def seek(self, *args): raise io.UnsupportedOperation
def archive(entries):
    output = NonSeekable()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        for name, value in entries: z.writestr(name, value)
    return output.getvalue()
manifest = {"commit":"${manifest.commit}","prHead":"${manifest.prHead}","workflowSha":"${manifest.workflowSha}","runId":"42","sourceRepo":"example/pharmacy","prNumber":2}
payload = archive([("src/server.mjs", "// synthetic test"), ("package.json", "{}"),
    ("data/stock.json", "{}"), ("release-manifest.json", json.dumps(manifest))])
outer = archive([("release.zip", payload),
    ("release.zip.sha256", hashlib.sha256(payload).hexdigest() + "  release.zip\n")])
sys.stdout.buffer.write(outer)
`;
  const generated = spawnSync("python", ["-c", script], { encoding: null });
  if (generated.error?.code === "ENOENT") return t.skip("Python is unavailable");
  assert.equal(generated.status, 0, generated.stderr?.toString());
  assert.deepEqual(inspectReleaseArtifact(new Uint8Array(generated.stdout)).manifest, manifest);
});
