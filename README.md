# Markdown Bold Lint

Detects bold rendering breakage in Markdown when a bold run ends with certain symbols and is immediately followed by CJK particles without spacing.

## Features

- Warns only for patterns that are known to break in real renderers.
- Detects bold text ending with symbols like `)`, `]`, `"`, `,`, `.`, `~`, `#`, `+`, `&`, `@`, `$`, `^`, `=`, `|`, `§`, `※`, `•`, `…`, `·`, `-`, `、`, `。`, `/` when CJK text follows *without a space* (including common fullwidth punctuation variants like `！？，：；％`, `／`, `）`, `】`).
- Warns when underscore-bold (`__...__`) is immediately followed by CJK text.
- Warns about invisible control characters (U+0000~U+001F, excluding tab/newline).

## Fix Suggestions

- Move the trailing symbol outside bold.
- Include the particle in bold.
- Insert a space after bold.
- Prefer bolding inside surrounding punctuation to avoid awkward spacing.

## Usage

Open a Markdown file and diagnostics will appear automatically.

## Extension Settings

- `markdownBoldLint.boldIssueUnderline`: Show underline diagnostics for bold rendering break patterns. Default is `true`. When `false`, issues only appear in Problems view.

## Known Issues

- Targets only cases that are known to break in some renderers.

## Release Notes

### 1.0.1

Initial release.
