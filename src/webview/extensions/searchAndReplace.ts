// MIT License
// Copyright (c) 2023 - 2024 Jeet Mandaliya (Github Username: sereneinserenade)
// Adapted for md-editor-plus — full command set with replace, regex, case-sensitive

import type { Dispatch, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchAndReplaceOptions {
  searchResultClass: string;
  currentResultClass: string;
}

export interface SearchAndReplaceStorage {
  searchTerm: string;
  replaceTerm: string;
  results: Range[];
  lastSearchTerm: string;
  caseSensitive: boolean;
  lastCaseSensitive: boolean;
  useRegex: boolean;
  lastUseRegex: boolean;
  resultIndex: number;
  lastResultIndex: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchTerm: (searchTerm: string) => ReturnType;
      setReplaceTerm: (replaceTerm: string) => ReturnType;
      setCaseSensitive: (caseSensitive: boolean) => ReturnType;
      setUseRegex: (useRegex: boolean) => ReturnType;
      resetIndex: () => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      replace: () => ReturnType;
      replaceAll: () => ReturnType;
    };
  }
}

interface TextNodesWithPosition {
  text: string;
  pos: number;
}

const getRegex = (
  s: string,
  useRegex: boolean,
  caseSensitive: boolean,
): RegExp => {
  return RegExp(
    useRegex ? s : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    caseSensitive ? "gu" : "gui",
  );
};

interface ProcessedSearches {
  decorationsToReturn: DecorationSet;
  results: Range[];
}

function processSearches(
  doc: PMNode,
  searchTerm: RegExp,
  searchResultClass: string,
  currentResultClass: string,
  resultIndex: number,
): ProcessedSearches {
  const decorations: Decoration[] = [];
  const results: Range[] = [];
  let textNodesWithPosition: TextNodesWithPosition[] = [];
  let index = 0;

  if (!searchTerm) {
    return { decorationsToReturn: DecorationSet.empty, results: [] };
  }

  doc?.descendants((node, pos) => {
    if (node.isText) {
      if (textNodesWithPosition[index]) {
        textNodesWithPosition[index] = {
          text: textNodesWithPosition[index].text + node.text,
          pos: textNodesWithPosition[index].pos,
        };
      } else {
        textNodesWithPosition[index] = { text: `${node.text}`, pos };
      }
    } else {
      index += 1;
    }
  });

  textNodesWithPosition = textNodesWithPosition.filter(Boolean);

  for (const element of textNodesWithPosition) {
    const { text, pos } = element;
    const matches = Array.from(text.matchAll(searchTerm)).filter(
      ([matchText]) => matchText.trim(),
    );

    for (const m of matches) {
      if (m[0] === "") break;
      if (m.index !== undefined) {
        results.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      }
    }
  }

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const className =
      i === resultIndex
        ? `${searchResultClass} ${currentResultClass}`
        : searchResultClass;
    decorations.push(Decoration.inline(r.from, r.to, { class: className }));
  }

  return {
    decorationsToReturn: DecorationSet.create(doc, decorations),
    results,
  };
}

const replaceCurrent = (
  replaceTerm: string,
  results: Range[],
  resultIndex: number,
  { state, dispatch }: { state: EditorState; dispatch: Dispatch },
) => {
  const result = results[resultIndex];
  if (!result) return;
  const { from, to } = result;
  if (dispatch) dispatch(state.tr.insertText(replaceTerm, from, to));
};

const rebaseNextResult = (
  replaceTerm: string,
  index: number,
  lastOffset: number,
  results: Range[],
): [number, Range[]] | null => {
  const nextIndex = index + 1;
  if (!results[nextIndex]) return null;
  const { from: currentFrom, to: currentTo } = results[index];
  const offset = currentTo - currentFrom - replaceTerm.length + lastOffset;
  const { from, to } = results[nextIndex];
  results[nextIndex] = { to: to - offset, from: from - offset };
  return [offset, results];
};

const replaceAllFn = (
  replaceTerm: string,
  results: Range[],
  { tr, dispatch }: { tr: Transaction; dispatch: Dispatch },
) => {
  let offset = 0;
  let resultsCopy = results.slice();
  if (!resultsCopy.length) return;

  for (let i = 0; i < resultsCopy.length; i += 1) {
    const { from, to } = resultsCopy[i];
    tr.insertText(replaceTerm, from, to);
    const rebaseResponse = rebaseNextResult(replaceTerm, i, offset, resultsCopy);
    if (!rebaseResponse) continue;
    offset = rebaseResponse[0];
    resultsCopy = rebaseResponse[1];
  }
  dispatch(tr);
};

export const searchAndReplacePluginKey = new PluginKey(
  "searchAndReplacePlugin",
);

export const SearchAndReplace = Extension.create<
  SearchAndReplaceOptions,
  SearchAndReplaceStorage
>({
  name: "searchAndReplace",

  addOptions() {
    return {
      searchResultClass: "search-result",
      currentResultClass: "search-result-current",
    };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      results: [],
      lastSearchTerm: "",
      caseSensitive: false,
      lastCaseSensitive: false,
      useRegex: false,
      lastUseRegex: false,
      resultIndex: 0,
      lastResultIndex: 0,
    };
  },

  addCommands() {
    return {
      setSearchTerm:
        (searchTerm: string) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.searchTerm = searchTerm;
          return false;
        },
      setReplaceTerm:
        (replaceTerm: string) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.replaceTerm = replaceTerm;
          return false;
        },
      setCaseSensitive:
        (caseSensitive: boolean) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.caseSensitive = caseSensitive;
          return false;
        },
      setUseRegex:
        (useRegex: boolean) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.useRegex = useRegex;
          return false;
        },
      resetIndex:
        () =>
        ({ editor }) => {
          editor.storage.searchAndReplace.resultIndex = 0;
          return false;
        },
      nextSearchResult:
        () =>
        ({ editor }) => {
          const { results, resultIndex } = editor.storage.searchAndReplace;
          const nextIndex = resultIndex + 1;
          if (results[nextIndex]) {
            editor.storage.searchAndReplace.resultIndex = nextIndex;
          } else {
            editor.storage.searchAndReplace.resultIndex = 0;
          }
          return false;
        },
      previousSearchResult:
        () =>
        ({ editor }) => {
          const { results, resultIndex } = editor.storage.searchAndReplace;
          const prevIndex = resultIndex - 1;
          if (results[prevIndex]) {
            editor.storage.searchAndReplace.resultIndex = prevIndex;
          } else {
            editor.storage.searchAndReplace.resultIndex = results.length - 1;
          }
          return false;
        },
      replace:
        () =>
        ({ editor, state, dispatch }) => {
          const { replaceTerm, results, resultIndex } =
            editor.storage.searchAndReplace;
          replaceCurrent(replaceTerm, results, resultIndex, { state, dispatch });
          return false;
        },
      replaceAll:
        () =>
        ({ editor, tr, dispatch }) => {
          const { replaceTerm, results } = editor.storage.searchAndReplace;
          replaceAllFn(replaceTerm, results, { tr, dispatch });
          return false;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { searchResultClass, currentResultClass } = this.options;

    const setLastSearchTerm = (t: string) => {
      editor.storage.searchAndReplace.lastSearchTerm = t;
    };
    const setLastCaseSensitive = (t: boolean) => {
      editor.storage.searchAndReplace.lastCaseSensitive = t;
    };
    const setLastUseRegex = (t: boolean) => {
      editor.storage.searchAndReplace.lastUseRegex = t;
    };
    const setLastResultIndex = (t: number) => {
      editor.storage.searchAndReplace.lastResultIndex = t;
    };

    return [
      new Plugin({
        key: searchAndReplacePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply({ doc, docChanged }, oldState) {
            const {
              searchTerm,
              lastSearchTerm,
              caseSensitive,
              lastCaseSensitive,
              useRegex,
              lastUseRegex,
              resultIndex,
              lastResultIndex,
            } = editor.storage.searchAndReplace;

            if (
              !docChanged &&
              lastSearchTerm === searchTerm &&
              lastCaseSensitive === caseSensitive &&
              lastUseRegex === useRegex &&
              lastResultIndex === resultIndex
            )
              return oldState;

            setLastSearchTerm(searchTerm);
            setLastCaseSensitive(caseSensitive);
            setLastUseRegex(useRegex);
            setLastResultIndex(resultIndex);

            if (!searchTerm) {
              editor.storage.searchAndReplace.results = [];
              return DecorationSet.empty;
            }

            let regex: RegExp;
            try {
              regex = getRegex(searchTerm, useRegex, caseSensitive);
            } catch {
              // Invalid regex — clear results silently
              editor.storage.searchAndReplace.results = [];
              return DecorationSet.empty;
            }

            const { decorationsToReturn, results } = processSearches(
              doc,
              regex,
              searchResultClass,
              currentResultClass,
              resultIndex,
            );

            editor.storage.searchAndReplace.results = results;
            return decorationsToReturn;
          },
        },
        props: {
          decorations(state: EditorState) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export default SearchAndReplace;
