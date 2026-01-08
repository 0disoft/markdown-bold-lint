// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "markdown-bold-lint";
const BOLD_REGEX = /(\*\*|__)([^\r\n]+?)\1/g;
const CJK_REGEX = /[가-힣一-龯ぁ-ゟ゠-ヿ]/;
const PROBLEMATIC_TRAILING_SYMBOL_REGEX =
  /[)"'\]\}）］｝”’」』】!?:;%+&@$\^=|\/§※•！？，：；％,.\~#\-·…。、＆＠／]$/;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

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
    if (document.languageId !== "markdown") {
      return;
    }
    const options = getLintOptions();
    const result = collectDiagnostics(document, options);
    diagnostics.set(document.uri, result.diagnostics);
    applyControlCharDecorations(document, result.controlCharDecorations, controlCharDecoration);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => refresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
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
}

export function deactivate() {}

type LintOptions = {
  showBoldUnderline: boolean;
};

function getLintOptions(): LintOptions {
  const config = vscode.workspace.getConfiguration("markdownBoldLint");
  return {
    showBoldUnderline: config.get<boolean>("boldIssueUnderline", false),
  };
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
    diagnostic.code = "MBL005";
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
  | { message: string; severity: vscode.DiagnosticSeverity; code: string; highlightExtra: number }
  | null {
  const isAfterCjk = after !== "" && CJK_REGEX.test(after);
  const endsWithProblematicSymbol = PROBLEMATIC_TRAILING_SYMBOL_REGEX.test(content);

  if (delimiter === "__" && isAfterCjk) {
    return {
      code: "MBL002",
      severity: vscode.DiagnosticSeverity.Warning,
      highlightExtra: 1,
      message:
        "Underscore bold (`__...__`) is immediately followed by CJK text without a space. Some Markdown renderers treat this as intraword and fail to close bold. Consider using `**...**` or inserting a space.",
    };
  }

  if (isAfterCjk && endsWithProblematicSymbol) {
    return {
      code: "MBL001",
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
