// Inline Math Node for single-dollar $...$ math
// Replaces the Decoration-based @tiptap/extension-mathematics to avoid
// the backslash-escaping problem during markdown serialization.

import { Node, mergeAttributes, nodeInputRule, nodePasteRule } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import katex from "katex";

export interface MathInlineOptions {
  HTMLAttributes: Record<string, any>;
}

// Match $...$ but not $$
const INLINE_MATH_INPUT_REGEX = /(?:^|[^$])(\$([^$\n]+)\$)$/;
const INLINE_MATH_PASTE_REGEX = /(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g;

export const MathInline = Node.create<MathInlineOptions>({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PMNode) {
          // Write raw $...$ without escaping
          state.write(`$${node.attrs.latex}$`);
        },
        parse: {
          setup(md: any) {
            // Add inline rule to recognize $...$
            if (!(md as any).__math_inline_custom_registered) {
              md.inline.ruler.after("escape", "math_inline_custom", mathInlineRule);
              (md as any).__math_inline_custom_registered = true;
            }
            md.renderer.rules.math_inline_custom = (tokens: any[], idx: number) => {
              const latex = tokens[idx].content;
              return `<span data-math-inline="" data-latex="${escapeAttr(latex)}"></span>`;
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
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-math-inline": "",
        "data-latex": node.attrs.latex,
        class: "math-inline-node",
        contenteditable: "false",
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.classList.add("math-inline-node");
      dom.setAttribute("data-math-inline", "");
      dom.contentEditable = "false";

      const renderMath = (latex: string) => {
        try {
          dom.innerHTML = "";
          katex.render(latex, dom, {
            throwOnError: false,
            displayMode: false,
          });
        } catch {
          dom.textContent = latex;
        }
      };

      renderMath(node.attrs.latex);

      // Click to edit
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const currentLatex = node.attrs.latex;
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentLatex;
        input.className = "math-inline-edit";
        input.spellcheck = false;

        dom.innerHTML = "";
        dom.appendChild(input);
        dom.classList.add("editing");
        input.focus();
        input.select();

        const finish = () => {
          const newLatex = input.value.trim();
          if (typeof getPos === "function") {
            if (newLatex) {
              editor.commands.command(({ tr }) => {
                const pos = getPos();
                if (pos === undefined) return false;
                tr.setNodeMarkup(pos, undefined, { latex: newLatex });
                return true;
              });
            } else {
              // Empty → delete node
              editor.commands.command(({ tr }) => {
                const pos = getPos();
                if (pos === undefined) return false;
                tr.delete(pos, pos + 1);
                return true;
              });
            }
          }
          dom.classList.remove("editing");
          if (newLatex) {
            dom.removeChild(input);
            renderMath(newLatex);
          }
        };

        input.addEventListener("blur", finish);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            input.blur();
          }
          if (ev.key === "Escape") {
            input.value = currentLatex;
            input.blur();
          }
        });
      });

      return { dom };
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: INLINE_MATH_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => ({ latex: match[2] }),
      }),
    ];
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: INLINE_MATH_PASTE_REGEX,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ];
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── markdown-it inline rule for $...$ ───────────────────────────────────────

function mathInlineRule(state: any, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;

  // Must start with $ but not $$
  if (src.charCodeAt(start) !== 0x24) return false;
  if (src.charCodeAt(start + 1) === 0x24) return false;
  // Check preceding char is not $
  if (start > 0 && src.charCodeAt(start - 1) === 0x24) return false;

  // Find closing $ (not $$)
  let end = start + 1;
  while (end < state.posMax) {
    const ch = src.charCodeAt(end);
    if (ch === 0x24) {
      // Make sure it's not $$
      if (end + 1 < src.length && src.charCodeAt(end + 1) === 0x24) {
        end += 2;
        continue;
      }
      break;
    }
    if (ch === 0x0a) return false; // no newlines in inline math
    if (ch === 0x5c) { // backslash — skip next char
      end++;
    }
    end++;
  }

  if (end >= state.posMax) return false;
  if (end === start + 1) return false; // empty $$ 

  const content = src.slice(start + 1, end);
  if (!content.trim()) return false;

  if (!silent) {
    const token = state.push("math_inline_custom", "span", 0);
    token.content = content;
    token.markup = "$";
  }

  state.pos = end + 1;
  return true;
}

export default MathInline;
