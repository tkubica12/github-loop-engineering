# html-docs runtime

Vendored from the author's supplied `html-docs` skill on 16 September 2026.
The runtime and canonical palette files are kept unchanged. See `LICENSE`
for the redistributed MIT notice.

The adjacent `package.json` establishes CommonJS for the skill's Node tools
inside this repository's ES-module package. It adds no dependency.

Synchronize marked source heads after updating the shared bootstrap or tokens:

```powershell
node docs\assets\html-docs\sync-head.js --check docs\guides\loop-engineering.html
```

Use `bundle.js` to export a source for single-file distribution. It embeds local
runtime assets and media, but not linked sibling guides, repositories or lab
files. Validate the exported file separately in an isolated folder.

Repository-specific command-copy and legacy-anchor behavior lives outside this
vendored runtime in `docs/assets/materials.js`.
