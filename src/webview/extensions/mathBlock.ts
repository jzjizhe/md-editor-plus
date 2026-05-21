// Block Math Node for multi-line $$...$$ display math
// Works as a dedicated TipTap Node (since multi-line formulas span paragraphs
// and cannot be handled by the Decoration-based inline Mathematics extension)

import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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

  addInputRules() {
    // Match $$ ... $$ on a single line (typed in a paragraph)
    return [
      {
        // When user types $$ content $$ and presses space/enter at end
        find: /^\$\$(.+)\$\$\s$/,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim();
          if (!latex) return;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      },
    ];
  },

  addCommands() {
    return {
      insertMathBlock:
        (attrs?: { latex?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex: attrs?.latex ?? "" },
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Cmd/Ctrl+Shift+M to insert a math block
      "Mod-Shift-m": () => {
        // Insert an empty math block and immediately trigger editing
        this.editor.commands.insertContent({
          type: this.name,
          attrs: { latex: "E = mc^2" },
        });
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const mathBlockType = this.type;
    return [
      new Plugin({
        key: new PluginKey("mathBlockAutoConvert"),
        appendTransaction(transactions, _oldState, newState) {
          // Only check when doc actually changed
          if (!transactions.some((t) => t.docChanged)) return null;

          const { doc } = newState;
          let tr = newState.tr;
          let modified = false;

          // Scan for paragraph sequences that form $$...$$
          doc.forEach((node, offset, index) => {
            if (modified) return; // one conversion per transaction to avoid position drift
            if (node.type.name !== "paragraph") return;
            const text = node.textContent.trim();

            // Case 1: Single paragraph like "$$ E=mc^2 $$"
            if (text.startsWith("$$") && text.endsWith("$$") && text.length > 4) {
              const latex = text.slice(2, -2).trim();
              if (!latex) return;
              const from = offset;
              const to = offset + node.nodeSize;
              tr = tr.replaceWith(from, to, mathBlockType.create({ latex }));
              modified = true;
              return;
            }

            // Case 2: Multi-paragraph pattern: para("$$") + content paras + para("$$")
            if (text === "$$") {
              // Look ahead for closing $$
              const startIdx = index;
              let endIdx = -1;
              const contentParts: string[] = [];
              let searchOffset = offset + node.nodeSize;

              for (let i = index + 1; i < doc.childCount; i++) {
                const child = doc.child(i);
                const childText = child.textContent.trim();
                if (child.type.name === "paragraph" && childText === "$$") {
                  endIdx = i;
                  break;
                }
                // Collect content
                contentParts.push(child.textContent);
                searchOffset += child.nodeSize;
              }

              if (endIdx > startIdx + 1) {
                const latex = contentParts.join("\n").trim();
                if (!latex) return;
                const from = offset;
                const to = searchOffset + doc.child(endIdx).nodeSize;
                tr = tr.replaceWith(from, to, mathBlockType.create({ latex }));
                modified = true;
              }
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
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

  // Check content after opening $$
  const firstLineContent = state.src.slice(startPos + 2, maxPos).trim();

  // Single-line: $$ E=mc^2 $$
  if (firstLineContent.endsWith("$$") && firstLineContent.length > 2) {
    if (silent) return true;
    const latex = firstLineContent.slice(0, -2).trim();
    if (!latex) return false;
    const token = state.push("math_block_custom", "div", 0);
    token.content = latex;
    token.map = [startLine, startLine + 1];
    token.block = true;
    state.line = startLine + 1;
    return true;
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
