// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "markdown-bold-lint";
const DIAGNOSTIC_CODES = {
  TRAILING_SYMBOL: "MBL001",
  UNDERSCORE_CJK: "MBL002",
  CONTROL_CHAR: "MBL005",
} as const;
const REFRESH_DEBOUNCE_MS = 150;
const MAX_PREWARM_FILES = 2000;
const EXCLUDED_WORKSPACE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/out/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.vscode-test/**",
] as const;
const MARKDOWN_GLOBS = [
  "**/*.md",
  "**/*.mdx",
  "**/*.mdc",
  "**/*.markdown",
  "**/*.mdoc",
] as const;
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".mdc", ".markdown", ".mdoc"]);
const BOLD_REGEX = /(\*\*|__)([^\r\n]+?)\1/g;
const CJK_REGEX = /[가-힣一-龯ぁ-ゟ゠-ヿ]/;
const PROBLEMATIC_TRAILING_SYMBOL_REGEX =
  /[)"'\]\}）］｝”’」』】!?:;%+&@$\^=|\/§※•！？，：；％,.\~#\-·…。、＆＠／]$/;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

type DiagnosticIssue = {
  message: string;
  severity: vscode.DiagnosticSeverity;
  code: DiagnosticCode;
  highlightExtra: number;
};

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  context.subscriptions.push(diagnostics);
  const controlCharDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("editorWarning.foreground"),
      margin: "0 0 0 2px",
    },
  });
  context.subscriptions.push(controlCharDecoration);

  const refresh = (document: vscode.TextDocument) => {
    if (!isMarkdownDocument(document)) {
      return;
    }
    const options = getLintOptions();
    const result = collectDiagnostics(document, options);
    diagnostics.set(document.uri, result.diagnostics);
    applyControlCharDecorations(document, result.controlCharDecorations, controlCharDecoration);
  };
  const refreshDebounced = debounce(refresh, REFRESH_DEBOUNCE_MS);
  context.subscriptions.push({ dispose: () => refreshDebounced.cancel() });

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => refreshDebounced(event.document)),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) {
        diagnostics.delete(uri);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document) {
        refresh(editor.document);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("markdownBoldLint")) {
        for (const document of vscode.workspace.textDocuments) {
          refresh(document);
        }
      }
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    refresh(document);
  }
  void prewarmWorkspaceDiagnostics(refresh);
}

export function deactivate() {}

type LintOptions = {
  showBoldUnderline: boolean;
};

function getLintOptions(): LintOptions {
  const config = vscode.workspace.getConfiguration("markdownBoldLint");
  return {
    showBoldUnderline: config.get<boolean>("boldIssueUnderline") ?? true,
  };
}

function isMarkdownDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === "markdown" || document.languageId === "mdx") {
    return true;
  }
  const lowerFileName = document.fileName.toLowerCase();
  for (const extension of MARKDOWN_EXTENSIONS) {
    if (lowerFileName.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function collectDiagnostics(
  document: vscode.TextDocument,
  options: LintOptions,
): {
  diagnostics: vscode.Diagnostic[];
  controlCharDecorations: vscode.DecorationOptions[];
} {
  const diagnostics: vscode.Diagnostic[] = [];
  const controlCharDecorations: vscode.DecorationOptions[] = [];
  let inCodeFence = false;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    const lineText = line.text;

    collectControlCharDiagnostics(lineNumber, lineText, diagnostics, controlCharDecorations);

    const fenceMatches = lineText.match(/```|~~~/g);
    if (fenceMatches && fenceMatches.length % 2 === 1) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    const maskedLine = maskInlineCode(lineText);
    for (const match of maskedLine.matchAll(BOLD_REGEX)) {
      const index = match.index ?? 0;
      if (index > 0 && lineText[index - 1] === "\\") {
        continue;
      }

      const fullMatch = match[0];
      const delimiter = match[1];
      const contentStart = index + delimiter.length;
      const contentEnd = index + fullMatch.length - delimiter.length;
      const content = lineText.slice(contentStart, contentEnd);
      const afterIndex = index + fullMatch.length;
      const after = lineText[afterIndex] ?? "";
      const issue = detectIssue(delimiter, content, after);
      if (!issue) {
        continue;
      }

      const highlightEnd = Math.min(lineText.length, afterIndex + issue.highlightExtra);
      const range = new vscode.Range(
        new vscode.Position(lineNumber, index),
        new vscode.Position(
          lineNumber,
          options.showBoldUnderline ? highlightEnd : index,
        ),
      );
      const diagnostic = new vscode.Diagnostic(range, issue.message, issue.severity);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = issue.code;
      diagnostics.push(diagnostic);
    }
  }

  return { diagnostics, controlCharDecorations };
}

function collectControlCharDiagnostics(
  lineNumber: number,
  lineText: string,
  diagnostics: vscode.Diagnostic[],
  controlCharDecorations: vscode.DecorationOptions[],
) {
  CONTROL_CHAR_REGEX.lastIndex = 0;
  for (const match of lineText.matchAll(CONTROL_CHAR_REGEX)) {
    const index = match.index ?? 0;
    const codePoint = lineText.charCodeAt(index);
    const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
    const range = new vscode.Range(
      new vscode.Position(lineNumber, index),
      new vscode.Position(lineNumber, index + 1),
    );
    controlCharDecorations.push({
      range,
      renderOptions: {
        after: {
          contentText: `[U+${hex}]`,
        },
      },
    });
    const diagnostic = new vscode.Diagnostic(
      range,
      `Invisible control character detected (U+${hex}). Remove it to avoid rendering or parsing issues.`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = DIAGNOSTIC_CODES.CONTROL_CHAR;
    diagnostics.push(diagnostic);
  }
}

function applyControlCharDecorations(
  document: vscode.TextDocument,
  decorations: vscode.DecorationOptions[],
  decorationType: vscode.TextEditorDecorationType,
) {
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === document.uri.toString()) {
      editor.setDecorations(decorationType, decorations);
    }
  }
}

function detectIssue(
  delimiter: string,
  content: string,
  after: string,
):
  | DiagnosticIssue
  | null {
  const isAfterCjk = after !== "" && CJK_REGEX.test(after);
  const endsWithProblematicSymbol = PROBLEMATIC_TRAILING_SYMBOL_REGEX.test(content);

  if (delimiter === "__" && isAfterCjk) {
    return {
      code: DIAGNOSTIC_CODES.UNDERSCORE_CJK,
      severity: vscode.DiagnosticSeverity.Warning,
      highlightExtra: 1,
      message:
        "Underscore bold (`__...__`) is immediately followed by CJK text without a space. Some Markdown renderers treat this as intraword and fail to close bold. Consider using `**...**` or inserting a space.",
    };
  }

  if (isAfterCjk && endsWithProblematicSymbol) {
    return {
      code: DIAGNOSTIC_CODES.TRAILING_SYMBOL,
      severity: vscode.DiagnosticSeverity.Warning,
      highlightExtra: 1,
      message:
        "Bold text ends with a symbol right before the closing marker and is immediately followed by CJK text without a space. Some Markdown renderers fail to close bold. Consider moving the symbol outside bold, adding a space, or including the particle in bold.",
    };
  }

  return null;
}

function maskInlineCode(lineText: string): string {
  let result = "";
  let index = 0;
  let inInlineCode = false;
  let tickLength = 0;

  while (index < lineText.length) {
    if (lineText[index] === "`") {
      let runEnd = index;
      while (runEnd < lineText.length && lineText[runEnd] === "`") {
        runEnd += 1;
      }
      const runLength = runEnd - index;

      if (!inInlineCode) {
        inInlineCode = true;
        tickLength = runLength;
      } else if (runLength === tickLength) {
        inInlineCode = false;
        tickLength = 0;
      }

      result += " ".repeat(runLength);
      index = runEnd;
      continue;
    }

    result += inInlineCode ? " " : lineText[index];
    index += 1;
  }

  return result;
}

function debounce<T extends (...args: never[]) => void>(
  fn: T,
  waitMs: number,
): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => fn(...args), waitMs);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}

async function prewarmWorkspaceDiagnostics(
  refresh: (document: vscode.TextDocument) => void,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return;
  }
  const include =
    MARKDOWN_GLOBS.length > 1 ? `{${MARKDOWN_GLOBS.join(",")}}` : MARKDOWN_GLOBS[0];
  const exclude =
    EXCLUDED_WORKSPACE_GLOBS.length > 0
      ? `{${EXCLUDED_WORKSPACE_GLOBS.join(",")}}`
      : undefined;
  const uris = await vscode.workspace.findFiles(
    include,
    exclude,
    MAX_PREWARM_FILES,
  );
  await Promise.all(
    uris.map(async (uri) => {
      const document = await vscode.workspace.openTextDocument(uri);
      refresh(document);
    }),
  );
}
