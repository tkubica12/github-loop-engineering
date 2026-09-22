export const expectedCompilerVersion = "v0.86.2";

export function compilerProbeVersion(result) {
  if (result.error) return `unavailable (${result.error.code ?? "spawn error"})`;
  if (result.status !== 0) return "unavailable";
  return `${result.stdout}\n${result.stderr}`.match(/\bv\d+\.\d+\.\d+\b/)?.[0] ?? "unknown";
}

export function assertCompilerStamp(content, label) {
  const header = content.match(/^# gh-aw-metadata: (.+)$/m)?.[1];
  if (!header) throw new Error(`${label}: missing Agentic Workflow compiler metadata.`);
  const metadata = JSON.parse(header);
  if (metadata.compiler_version !== expectedCompilerVersion) {
    throw new Error(`${label}: compiled with ${metadata.compiler_version}; expected ${expectedCompilerVersion}.`);
  }
  return metadata.compiler_version;
}
