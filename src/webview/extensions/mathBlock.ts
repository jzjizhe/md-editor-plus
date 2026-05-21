// Block Math Node for multi-line $$...$$ display math
// Works as a dedicated TipTap Node (since multi-line formulas span paragraphs
// and cannot be handled by the Decoration-based inline Mathematics extension)

import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import katex from "katex";

export interface MathBlockOptions {
  HTMLAttributes: Record<string, any>;
}

export const MathBlock = Node.create<MathBlockOptions>({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PMNode) {
          state.write(`$$\n${node.attrs.latex}\n$$`);
          state.closeBlock(node);
        },
        parse: {
          setup(md: any) {
            // Avoid re-registering if already set up (setup is called on every parse)
            if (!(md as any).__math_block_custom_registered) {
              md.block.ruler.before("fence", "math_block_custom", mathBlockRule);
              (md as any).__math_block_custom_registered = true;
            }
            // Renderer can be safely overwritten
            md.renderer.rules.math_block_custom = (tokens: any[], idx: number) => {
              const latex = tokens[idx].content;
              return `<div data-math-block="" data-latex="${escapeAttr(latex)}"></div>`;
            };
          },
        },
      },
    };
  },

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-latex") || element.textContent || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = node.attrs.latex || "";
    let rendered: string;
    try {
      rendered = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      rendered = `<code class="math-error">${escapeHtml(latex)}</code>`;
    }
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-math-block": "",
        "data-latex": latex,
        class: "math-block-node",
        contenteditable: "false",
      }),
      ["div", { class: "math-block-render" }],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.classList.add("math-block-node");
      dom.setAttribute("data-math-block", "");
      dom.contentEditable = "false";

      const renderContainer = document.createElement("div");
      renderContainer.classList.add("math-block-render");
      dom.appendChild(renderContainer);

      const renderMath = (latex: string) => {
        try {
          renderContainer.innerHTML = katex.renderToString(latex, {
            throwOnError: false,
            displayMode: true,
          });
        } catch {
          renderContainer.innerHTML = `<code class="math-error">${escapeHtml(latex)}</code>`;
        }
      };

      renderMath(node.attrs.latex);

      // Double-click to edit
      dom.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentLatex = node.attrs.latex;
        const textarea = document.createElement("textarea");
        textarea.value = currentLatex;
        textarea.className = "math-block-edit";
        textarea.rows = Math.max(3, currentLatex.split("\n").length + 1);
        textarea.spellcheck = false;

        dom.replaceChild(textarea, renderContainer);
        dom.classList.add("editing");
        textarea.focus();
        // Move cursor to end
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        const finish = () => {
          const newLatex = textarea.value;
          if (typeof getPos === "function") {
            editor.commands.command(({ tr }) => {
              const pos = getPos();
              if (pos === undefined) return false;
              tr.setNodeMarkup(pos, undefined, { latex: newLatex });
              return true;
            });
          }
          dom.classList.remove("editing");
          dom.replaceChild(renderContainer, textarea);
          renderMath(newLatex);
        };

        textarea.addEventListener("blur", finish);
        textarea.addEventListener("keydown", (ev) => {
          // Cmd/Ctrl+Enter to confirm
          if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
            ev.preventDefault();
            textarea.blur();
          }
          // Escape to cancel
          if (ev.key === "Escape") {
            textarea.value = currentLatex;
            textarea.blur();
          }
        });
      });

      return { dom };
    };
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

// ─── markdown-it block rule for $$...$$ ──────────────────────────────────────

function mathBlockRule(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const maxPos = state.eMarks[startLine];

  // Must start with $$
  if (startPos + 2 > maxPos) return false;
  if (state.src.charCodeAt(startPos) !== 0x24 || state.src.charCodeAt(startPos + 1) !== 0x24) {
    return false;
  }

  // Check if it's a single-line $$ ... $$ (skip — let inline handle it)
  const firstLineContent = state.src.slice(startPos + 2, maxPos).trim();
  if (firstLineContent.endsWith("$$")) {
    // Single line like $$ E=mc^2 $$ — skip, let inline Mathematics handle it
    return false;
  }

  // Silent mode — just checking if rule matches
  if (silent) return true;

  // Find closing $$
  let nextLine = startLine + 1;
  let found = false;

  while (nextLine < endLine) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const lineText = state.src.slice(lineStart, lineEnd).trim();

    if (lineText === "$$") {
      found = true;
      break;
    }
    nextLine++;
  }

  if (!found) return false;

  // Collect content between opening $$ and closing $$
  const contentLines: string[] = [];
  for (let i = startLine + 1; i < nextLine; i++) {
    const lineStart = state.bMarks[i] + state.tShift[i];
    const lineEnd = state.eMarks[i];
    contentLines.push(state.src.slice(lineStart, lineEnd));
  }

  // If opening line has content after $$, include it
  if (firstLineContent) {
    contentLines.unshift(firstLineContent);
  }

  const content = contentLines.join("\n");

  // Create token
  const token = state.push("math_block_custom", "div", 0);
  token.content = content;
  token.map = [startLine, nextLine + 1];
  token.block = true;

  state.line = nextLine + 1;
  return true;
}

export default MathBlock;
