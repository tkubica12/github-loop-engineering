import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Inflate } from "fflate";

const shaPattern = /^[a-f0-9]{40}$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (view, offset) => view.getUint16(offset, true);
const u32 = (view, offset) => view.getUint32(offset, true);
const utf8 = new TextDecoder("utf-8", { fatal: true });

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function updateCrc(crc, bytes) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

function decodeName(bytes, utf8Flag) {
  if (!utf8Flag) {
    assert.ok(bytes.every((byte) => byte < 0x80), "Unsupported non-UTF-8 ZIP filename");
    return String.fromCharCode(...bytes);
  }
  return utf8.decode(bytes);
}

function findEndOfCentralDirectory(bytes, view) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (u32(view, offset) === 0x06054b50 &&
      offset + 22 + u16(view, offset + 20) === bytes.length) return offset;
  }
  assert.fail("Invalid or unsupported ZIP end record");
}

function parseEntries(bytes) {
  const view = viewOf(bytes);
  const endOffset = findEndOfCentralDirectory(bytes, view);
  assert.equal(u16(view, endOffset + 4), 0, "Multi-disk ZIP archives are unsupported");
  assert.equal(u16(view, endOffset + 6), 0, "Multi-disk ZIP archives are unsupported");
  const diskEntries = u16(view, endOffset + 8);
  const entryCount = u16(view, endOffset + 10);
  assert.equal(diskEntries, entryCount, "Multi-disk ZIP archives are unsupported");
  assert.notEqual(entryCount, 0xffff, "ZIP64 archives are unsupported");
  const centralSize = u32(view, endOffset + 12);
  const centralOffset = u32(view, endOffset + 16);
  assert.notEqual(centralSize, 0xffffffff, "ZIP64 archives are unsupported");
  assert.notEqual(centralOffset, 0xffffffff, "ZIP64 archives are unsupported");
  assert.equal(centralOffset + centralSize, endOffset, "Invalid ZIP central directory bounds");

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.ok(cursor + 46 <= endOffset && u32(view, cursor) === 0x02014b50,
      "Invalid ZIP central directory entry");
    const flags = u16(view, cursor + 8);
    const compression = u16(view, cursor + 10);
    const crc = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const declaredSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const disk = u16(view, cursor + 34);
    const externalAttributes = u32(view, cursor + 38);
    const localOffset = u32(view, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;

    assert.ok(end <= endOffset, "Invalid ZIP central directory entry bounds");
    assert.equal(disk, 0, "Multi-disk ZIP archives are unsupported");
    assert.ok(compressedSize !== 0xffffffff && declaredSize !== 0xffffffff &&
      localOffset !== 0xffffffff, "ZIP64 archives are unsupported");
    assert.equal(flags & ~0x080e, 0, "Encrypted or unsupported ZIP flags");
    assert.ok(compression === 0 || compression === 8, `Unsupported ZIP compression method ${compression}`);
    if (compression === 0) assert.equal(flags & 0x0006, 0, "Invalid stored-entry ZIP flags");

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeName(nameBytes, Boolean(flags & 0x0800));
    assert.ok(name && !name.includes("\0") && !name.startsWith("/") &&
      !/^[A-Za-z]:/.test(name) && !name.includes("\\") &&
      !name.split("/").includes(".."), "Unsafe archive member");
    assert.ok(!seen.has(name), "Duplicate archive member");
    seen.add(name);
    const unixMode = externalAttributes >>> 16;
    assert.notEqual(unixMode & 0o170000, 0o120000, "ZIP symbolic links are unsupported");

    entries.push({
      name, nameBytes, flags, compression, crc, compressedSize, declaredSize, localOffset
    });
    cursor = end;
  }
  assert.equal(cursor, endOffset, "Invalid ZIP central directory size");

  const localOrder = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  for (let index = 0; index < localOrder.length; index += 1) {
    const entry = localOrder[index];
    const nextOffset = localOrder[index + 1]?.localOffset ?? centralOffset;
    assert.ok(entry.localOffset + 30 <= centralOffset &&
      u32(view, entry.localOffset) === 0x04034b50, "Invalid ZIP local header");
    const localFlags = u16(view, entry.localOffset + 6);
    const localCompression = u16(view, entry.localOffset + 8);
    const localCrc = u32(view, entry.localOffset + 14);
    const localCompressedSize = u32(view, entry.localOffset + 18);
    const localDeclaredSize = u32(view, entry.localOffset + 22);
    const localNameLength = u16(view, entry.localOffset + 26);
    const localExtraLength = u16(view, entry.localOffset + 28);
    const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + entry.compressedSize;

    assert.ok(dataOffset <= centralOffset && dataEnd <= nextOffset, "Invalid ZIP entry bounds");
    assert.equal(localFlags, entry.flags, "ZIP local/central flags mismatch");
    assert.equal(localCompression, entry.compression, "ZIP local/central compression mismatch");
    assert.deepEqual(bytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameLength),
      entry.nameBytes, "ZIP local/central filename mismatch");

    if (!(entry.flags & 0x0008)) {
      assert.equal(localCrc, entry.crc, "ZIP local/central CRC mismatch");
      assert.equal(localCompressedSize, entry.compressedSize, "ZIP local/central compressed size mismatch");
      assert.equal(localDeclaredSize, entry.declaredSize, "ZIP local/central expanded size mismatch");
      assert.equal(dataEnd, nextOffset, "Unexpected data between ZIP entries");
    } else {
      assert.ok(localCrc === 0 || localCrc === entry.crc, "ZIP local/central CRC mismatch");
      assert.ok(localCompressedSize === 0 || localCompressedSize === entry.compressedSize,
        "ZIP local/central compressed size mismatch");
      assert.ok(localDeclaredSize === 0 || localDeclaredSize === entry.declaredSize,
        "ZIP local/central expanded size mismatch");
      const descriptorLength = nextOffset - dataEnd;
      assert.ok(descriptorLength === 12 || descriptorLength === 16, "Invalid ZIP data descriptor bounds");
      let descriptor = dataEnd;
      if (descriptorLength === 16) {
        assert.equal(u32(view, descriptor), 0x08074b50, "Invalid ZIP data descriptor signature");
        descriptor += 4;
      }
      assert.equal(u32(view, descriptor), entry.crc, "ZIP data descriptor CRC mismatch");
      assert.equal(u32(view, descriptor + 4), entry.compressedSize,
        "ZIP data descriptor compressed size mismatch");
      assert.equal(u32(view, descriptor + 8), entry.declaredSize,
        "ZIP data descriptor expanded size mismatch");
    }
    entry.dataOffset = dataOffset;
  }
  return entries;
}

function unzipBounded(bytes, maxBytes) {
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0, "Invalid ZIP size limit");
  assert.ok(bytes.length > 0 && bytes.length <= maxBytes, "ZIP exceeds the configured compressed size");
  const entries = parseEntries(bytes);
  const files = Object.create(null);
  let expandedTotal = 0;

  for (const entry of entries) {
    const chunks = [];
    let actualSize = 0;
    let crc = 0xffffffff;
    let finalSeen = entry.compression === 0;
    const emit = (chunk, final = false) => {
      actualSize += chunk.length;
      expandedTotal += chunk.length;
      assert.ok(actualSize <= maxBytes && expandedTotal <= maxBytes,
        "ZIP exceeds the configured expanded size");
      crc = updateCrc(crc, chunk);
      if (chunk.length) chunks.push(Uint8Array.from(chunk));
      if (final) finalSeen = true;
    };
    const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);

    if (entry.compression === 0) {
      emit(compressed, true);
    } else {
      const inflate = new Inflate(emit);
      if (!compressed.length) inflate.push(compressed, true);
      for (let offset = 0; offset < compressed.length; offset += 64) {
        const end = Math.min(offset + 64, compressed.length);
        inflate.push(compressed.subarray(offset, end), end === compressed.length);
      }
    }

    assert.ok(finalSeen, `Incomplete ZIP entry: ${entry.name}`);
    assert.equal(actualSize, entry.declaredSize, `ZIP expanded size mismatch: ${entry.name}`);
    assert.equal((crc ^ 0xffffffff) >>> 0, entry.crc, `ZIP CRC mismatch: ${entry.name}`);
    const content = new Uint8Array(actualSize);
    let outputOffset = 0;
    for (const chunk of chunks) {
      content.set(chunk, outputOffset);
      outputOffset += chunk.length;
    }
    files[entry.name] = content;
  }
  return files;
}

export function inspectReleasePackage(bytes, maxBytes = 5 * 1024 * 1024) {
  const files = unzipBounded(bytes, maxBytes);
  const raw = files["release-manifest.json"];
  assert.ok(raw && raw.length <= 16_384, "Missing or oversized package manifest");
  const manifest = JSON.parse(Buffer.from(raw).toString("utf8"));
  for (const field of ["commit", "prHead", "workflowSha"]) assert.match(manifest[field] ?? "", shaPattern);
  assert.match(manifest.runId ?? "", /^[1-9][0-9]*$/);
  assert.match(manifest.sourceRepo ?? "", /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
  assert.ok(Number.isSafeInteger(manifest.prNumber) && manifest.prNumber > 0);
  assert.ok(files["src/server.mjs"] && files["package.json"] && files["data/stock.json"]);
  const sourceBlobs = Object.entries(files).filter(([path]) => !path.endsWith("/") && path !== "release-manifest.json")
    .map(([path, content]) => ({
      path, sha: createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex")
    }));
  return { manifest, sourceBlobs, sha256: digest(bytes) };
}

export function inspectReleaseArtifact(bytes, maxBytes = 5 * 1024 * 1024) {
  const files = unzipBounded(bytes, maxBytes);
  assert.ok(files["release.zip"] && files["release.zip.sha256"], "Missing release payload or checksum");
  const expected = Buffer.from(files["release.zip.sha256"]).toString("utf8").trim();
  assert.match(expected, /^[a-f0-9]{64}\s+release\.zip$/);
  const payload = inspectReleasePackage(files["release.zip"], maxBytes);
  assert.equal(payload.sha256, expected.split(/\s+/)[0], "Package checksum mismatch");
  return { ...payload, artifactSha256: digest(bytes) };
}
