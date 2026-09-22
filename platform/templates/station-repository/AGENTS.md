# Pharmacy reservation service

Use the issue and acceptance criteria as the implementation contract.

- Use Node.js 20 or newer and built-in modules only.
- Keep the service dependency-free, deterministic, and entirely synthetic.
- Preserve the public JSON response shape and explicit HTTP status codes.
- Do not automatically reserve a suggested substitute.
- Cover changed behavior with `node:test` and run `npm test` before proposing a pull request.
- Keep the diff bounded to the task; show the plan before changing files.
- Do not change workflows, ownership, or agent instructions without explicit platform-owner review.

The same contract applies to GitHub Copilot and external harnesses such as OpenCode. Agent output is a proposal, not approval.
