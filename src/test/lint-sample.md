# Markdown Bold Lint Sample

Purpose: Verify diagnostics while running the extension in an Extension Development Host.
Audience: VS Code extension developers and testers.
Scope: Bold markers, CJK adjacency, trailing symbols, inline code, code fences.
Out of scope: Full Markdown linting and non-markdown files.

## How to use
1. Run the extension with F5.
2. Open this file.
3. Check the Problems panel and inline underlines for the "Expected warning" lines.

## Expected warnings
- MBL002: Underscore bold followed by CJK without space.
__bold__가

- MBL001: Bold ends with a symbol and is followed by CJK without space.
**Hello!**가

## Expected no warnings
- Space before CJK.
**Hello!** 가

- No trailing symbol.
**Hello**가

- Underscore with space after.
__bold__ 가

## Inline code (should be ignored)
`**Hello!**가`

## Code fence (should be ignored)
```md
**Hello!**가
__bold__가
```

## Optional control character check
Insert a control character (e.g., U+0007) into the line below to verify MBL005.
Control char here:

