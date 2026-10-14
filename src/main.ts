import {
  App,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import {
  StateEffect,
  StateField,
  Text,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

// ============================================================================
// 1. 插件配置接口与默认值
// ============================================================================

export interface CodeBlockFolderSettings {
  /** 是否默认折叠所有代码块 */
  defaultFoldAll: boolean;
  /** 是否开启超过指定行数自动折叠 */
  autoFoldByLineCount: boolean;
  /** 自动折叠的行数阈值 */
  autoFoldThreshold: number;
}

export const DEFAULT_SETTINGS: CodeBlockFolderSettings = {
  defaultFoldAll: false,
  autoFoldByLineCount: false,
  autoFoldThreshold: 15,
};

// ============================================================================
// 2. 工具函数：语言名称美化与围栏解析
// ============================================================================

const LANGUAGE_DISPLAY_MAP: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  shell: "Shell",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  xml: "XML",
  sql: "SQL",
  md: "Markdown",
  markdown: "Markdown",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  csharp: "C#",
  java: "Java",
  go: "Go",
  golang: "Go",
  rs: "Rust",
  rust: "Rust",
  rb: "Ruby",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  kt: "Kotlin",
  kotlin: "Kotlin",
  dart: "Dart",
  r: "R",
  lua: "Lua",
  vim: "Vim",
  dockerfile: "Dockerfile",
  docker: "Docker",
  makefile: "Makefile",
  graphql: "GraphQL",
  toml: "TOML",
  ini: "INI",
  diff: "Diff",
  promql: "PromQL",
  plaintext: "Text",
  text: "Text",
  txt: "Text",
};

/**
 * 格式化语言显示名称
 */
export function formatLanguageName(rawLang: string): string {
  const clean = (rawLang || "").trim().toLowerCase();
  if (!clean) return "";
  if (LANGUAGE_DISPLAY_MAP[clean]) {
    return LANGUAGE_DISPLAY_MAP[clean];
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export interface ParsedCodeBlock {
  /** 代码块首行起始字符偏移 (beginLine.from) */
  from: number;
  /** 代码块末行结束字符偏移 (endLine.to) */
  to: number;
  /** 首行行号 (1-indexed) */
  beginLineNum: number;
  /** 末行行号 (1-indexed) */
  endLineNum: number;
  /** 内部代码总行数 */
  lineCount: number;
  /** 格式化后的语言名称 */
  language: string;
  /** 是否在代码块首行显式标记了 fold / collapse */
  explicitFold: boolean;
}

const FENCE_OPEN_REGEX = /^(?:[\s>]*)(`{3,}|~{3,})(.*)$/;

/**
 * 扫描文档并解析所有闭合的 Markdown 围栏代码块
 */
export function parseCodeBlocks(doc: Text): ParsedCodeBlock[] {
  const blocks: ParsedCodeBlock[] = [];
  let inBlock = false;
  let fenceChar = "";
  let fenceLen = 0;
  let beginLineNum = 1;
  let beginFrom = 0;
  let rawInfo = "";

  const totalLines = doc.lines;
  for (let i = 1; i <= totalLines; i++) {
    const line = doc.line(i);
    const text = line.text;

    if (!inBlock) {
      const match = FENCE_OPEN_REGEX.exec(text);
      if (match) {
        const fence = match[1];
        const info = match[2].trim();
        if (fence[0] === "`" && info.includes("`")) {
          continue;
        }
        inBlock = true;
        fenceChar = fence[0];
        fenceLen = fence.length;
        beginLineNum = i;
        beginFrom = line.from;
        rawInfo = info;
      }
    } else {
      const closeMatch = FENCE_OPEN_REGEX.exec(text);
      if (closeMatch) {
        const closeFence = closeMatch[1];
        const trailing = closeMatch[2].trim();
        if (
          closeFence[0] === fenceChar &&
          closeFence.length >= fenceLen &&
          trailing === ""
        ) {
          const endLineNum = i;
          const lineCount = Math.max(0, endLineNum - beginLineNum - 1);
          const tokens = rawInfo.split(/\s+/).filter(Boolean);
          let langToken = "";
          let explicitFold = false;

          for (const token of tokens) {
            const lower = token.toLowerCase();
            if (lower === "fold" || lower === "collapse" || lower === "folded") {
              explicitFold = true;
            } else if (!langToken) {
              langToken = token;
            }
          }

          blocks.push({
            from: beginFrom,
            to: line.to,
            beginLineNum,
            endLineNum,
            lineCount,
            language: formatLanguageName(langToken),
            explicitFold,
          });

          inBlock = false;
        }
      }
    }
  }

  return blocks;
}

/**
 * 判断某个代码块默认是否应该折叠
 */
export function shouldDefaultCollapse(
  block: { lineCount: number; explicitFold: boolean },
  settings: CodeBlockFolderSettings
): boolean {
  if (block.explicitFold) return true;
  if (settings.defaultFoldAll) return true;
  if (
    settings.autoFoldByLineCount &&
    block.lineCount >= settings.autoFoldThreshold
  ) {
    return true;
  }
  return false;
}

// ============================================================================
// 3. 构建右上角「代码语言 | 行数  展开折叠符号」控件
// ============================================================================

function createChevronSvg(): SVGSVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", "6 9 12 15 18 9");
  svg.appendChild(polyline);
  return svg;
}

/**
 * 在不动原主题顶栏的前提下，仅生成右上角（复制按钮左侧）的「代码语言 | 行数  展开折叠符号」
 */
function buildTopRightControlsDOM(options: {
  language: string;
  lineCount: number;
  collapsed: boolean;
  onToggle: (e: MouseEvent, controlsEl: HTMLElement) => void;
}): HTMLElement {
  const { language, lineCount, collapsed, onToggle } = options;

  const controls = document.createElement("span");
  controls.className = `cbf-controls${collapsed ? " is-collapsed" : ""}`;
  controls.setAttribute("role", "button");
  controls.setAttribute("tabindex", "0");
  controls.setAttribute("aria-expanded", collapsed ? "false" : "true");

  // 1. 代码语言 | 行数
  const meta = document.createElement("span");
  meta.className = "cbf-meta";

  if (language) {
    const langEl = document.createElement("span");
    langEl.className = "cbf-lang";
    langEl.textContent = language;
    meta.appendChild(langEl);

    const divider = document.createElement("span");
    divider.className = "cbf-divider";
    divider.textContent = "|";
    meta.appendChild(divider);
  }

  const linesEl = document.createElement("span");
  linesEl.className = "cbf-lines";
  linesEl.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
  meta.appendChild(linesEl);

  // 2. 展开折叠符号
  const foldIcon = document.createElement("span");
  foldIcon.className = "cbf-fold-icon";
  foldIcon.appendChild(createChevronSvg());

  controls.appendChild(meta);
  controls.appendChild(foldIcon);

  controls.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  controls.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle(e, controls);
  });

  controls.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onToggle(e as unknown as MouseEvent, controls);
    }
  });

  return controls;
}

// ============================================================================
// 4. CodeMirror 6 状态管理与右上角 Widget (实时预览 & 源码模式)
// ============================================================================

export const toggleFoldEffect = StateEffect.define<{
  pos: number;
  collapsed?: boolean;
}>();

export const setAllFoldEffect = StateEffect.define<{
  collapsed: boolean;
}>();

export const refreshSettingsEffect = StateEffect.define<void>();

interface FoldFieldState {
  overrides: Map<number, boolean>;
  decorations: DecorationSet;
}

class CodeBlockControlsWidget extends WidgetType {
  constructor(
    readonly blockFrom: number,
    readonly language: string,
    readonly lineCount: number,
    readonly collapsed: boolean
  ) {
    super();
  }

  eq(other: CodeBlockControlsWidget): boolean {
    return (
      this.blockFrom === other.blockFrom &&
      this.language === other.language &&
      this.lineCount === other.lineCount &&
      this.collapsed === other.collapsed
    );
  }

  toDOM(view: EditorView): HTMLElement {
    return buildTopRightControlsDOM({
      language: this.language,
      lineCount: this.lineCount,
      collapsed: this.collapsed,
      onToggle: () => {
        view.dispatch({
          effects: toggleFoldEffect.of({
            pos: this.blockFrom,
            collapsed: !this.collapsed,
          }),
        });
      },
    });
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildEditorDecorations(
  doc: Text,
  overrides: Map<number, boolean>,
  settings: CodeBlockFolderSettings
): DecorationSet {
  const blocks = parseCodeBlocks(doc);
  if (blocks.length === 0) return Decoration.none;

  const decorations = [];

  for (const block of blocks) {
    const isCollapsed = overrides.has(block.from)
      ? overrides.get(block.from)!
      : shouldDefaultCollapse(block, settings);

    decorations.push(
      Decoration.line({
        attributes: {
          class: isCollapsed
            ? "cbf-cm-begin-collapsed"
            : "cbf-cm-begin-expanded",
        },
      }).range(block.from)
    );

    decorations.push(
      Decoration.widget({
        widget: new CodeBlockControlsWidget(
          block.from,
          block.language,
          block.lineCount,
          isCollapsed
        ),
        side: 1,
      }).range(block.from)
    );

    if (isCollapsed) {
      for (
        let lineNum = block.beginLineNum + 1;
        lineNum <= block.endLineNum;
        lineNum++
      ) {
        const line = doc.line(lineNum);
        decorations.push(
          Decoration.line({
            attributes: { class: "cbf-cm-line-collapsed" },
          }).range(line.from)
        );
      }
    }
  }

  return Decoration.set(decorations, true);
}

export function createCodeBlockFoldField(
  getSettings: () => CodeBlockFolderSettings
) {
  return StateField.define<FoldFieldState>({
    create(state) {
      const overrides = new Map<number, boolean>();
      const decorations = buildEditorDecorations(
        state.doc,
        overrides,
        getSettings()
      );
      return { overrides, decorations };
    },
    update(value, tr) {
      let overrides = value.overrides;
      let needsRebuild = false;

      if (tr.docChanged) {
        const mapped = new Map<number, boolean>();
        for (const [pos, collapsed] of overrides.entries()) {
          const newPos = tr.changes.mapPos(pos, 1);
          if (newPos >= 0 && newPos <= tr.newDoc.length) {
            mapped.set(newPos, collapsed);
          }
        }
        overrides = mapped;
        needsRebuild = true;
      }

      for (const effect of tr.effects) {
        if (effect.is(toggleFoldEffect)) {
          overrides = new Map(overrides);
          const { pos, collapsed } = effect.value;
          if (collapsed !== undefined) {
            overrides.set(pos, collapsed);
          } else {
            const blocks = parseCodeBlocks(tr.state.doc);
            const target = blocks.find((b) => b.from === pos);
            const current = overrides.has(pos)
              ? overrides.get(pos)!
              : target
              ? shouldDefaultCollapse(target, getSettings())
              : false;
            overrides.set(pos, !current);
          }
          needsRebuild = true;
        } else if (effect.is(setAllFoldEffect)) {
          overrides = new Map();
          const blocks = parseCodeBlocks(tr.state.doc);
          for (const block of blocks) {
            overrides.set(block.from, effect.value.collapsed);
          }
          needsRebuild = true;
        } else if (effect.is(refreshSettingsEffect)) {
          needsRebuild = true;
        }
      }

      if (!needsRebuild) {
        return value;
      }

      return {
        overrides,
        decorations: buildEditorDecorations(
          tr.state.doc,
          overrides,
          getSettings()
        ),
      };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (val) => val.decorations),
  });
}

// ============================================================================
// 5. 插件主类 (支持阅读视图 + 实时预览/编辑模式 + 命令面板 + 设置页)
// ============================================================================

export default class CodeBlockFolderPlugin extends Plugin {
  settings: CodeBlockFolderSettings = DEFAULT_SETTINGS;
  private foldFieldExtension!: ReturnType<typeof createCodeBlockFoldField>;

  async onload() {
    await this.loadSettings();

    // 1. 注册 CodeMirror 6 扩展（实时预览 & 源码模式）
    this.foldFieldExtension = createCodeBlockFoldField(() => this.settings);
    this.registerEditorExtension(this.foldFieldExtension);

    // 2. 注册 Markdown 后处理器（阅读视图 Reading View）
    this.registerMarkdownPostProcessor((el, ctx) => {
      const codeBlocks = el.querySelectorAll("pre > code");
      codeBlocks.forEach((codeEl) => {
        const pre = codeEl.parentElement as HTMLPreElement | null;
        if (!pre || pre.classList.contains("cbf-reading-pre")) return;

        if (
          codeEl.classList.contains("language-mermaid") ||
          pre.classList.contains("frontmatter")
        ) {
          return;
        }

        pre.classList.add("cbf-reading-pre");

        let rawLang = "";
        let explicitFold = false;
        codeEl.classList.forEach((cls) => {
          if (cls.startsWith("language-")) {
            rawLang = cls.replace("language-", "");
          } else if (cls === "fold" || cls === "collapse" || cls === "folded") {
            explicitFold = true;
          }
        });

        const sectionInfo = ctx.getSectionInfo(pre);
        if (sectionInfo) {
          const firstLine =
            sectionInfo.text.split("\n")[sectionInfo.lineStart] || "";
          const match = FENCE_OPEN_REGEX.exec(firstLine);
          if (match) {
            const tokens = match[2].trim().split(/\s+/).filter(Boolean);
            for (const token of tokens) {
              const lower = token.toLowerCase();
              if (
                lower === "fold" ||
                lower === "collapse" ||
                lower === "folded"
              ) {
                explicitFold = true;
              } else if (!rawLang) {
                rawLang = token;
              }
            }
          }
        }

        const language = formatLanguageName(rawLang);

        const rawCode = codeEl.textContent || "";
        const normalizedCode = rawCode.endsWith("\n")
          ? rawCode.slice(0, -1)
          : rawCode;
        const lineCount =
          normalizedCode.length === 0 ? 0 : normalizedCode.split("\n").length;

        let isCollapsed = shouldDefaultCollapse(
          { lineCount, explicitFold },
          this.settings
        );

        if (isCollapsed) {
          pre.classList.add("is-collapsed");
        }

        const controls = buildTopRightControlsDOM({
          language,
          lineCount,
          collapsed: isCollapsed,
          onToggle: (_e, controlsEl) => {
            isCollapsed = !isCollapsed;
            pre.classList.toggle("is-collapsed", isCollapsed);
            controlsEl.classList.toggle("is-collapsed", isCollapsed);
            controlsEl.setAttribute(
              "aria-expanded",
              isCollapsed ? "false" : "true"
            );
          },
        });

        pre.appendChild(controls);
      });
    });

    // 3. 注册全局快捷命令
    this.addCommand({
      id: "fold-all-code-blocks",
      name: "折叠当前笔记中的所有代码块 (Fold all code blocks)",
      callback: () => this.setAllCodeBlocksFold(true),
    });

    this.addCommand({
      id: "unfold-all-code-blocks",
      name: "展开当前笔记中的所有代码块 (Unfold all code blocks)",
      callback: () => this.setAllCodeBlocksFold(false),
    });

    this.addCommand({
      id: "toggle-code-block-at-cursor",
      name: "切换当前光标所在代码块的折叠状态 (Toggle code block fold at cursor)",
      editorCallback: (editor) => {
        const cmView = (editor as any).cm as EditorView | undefined;
        if (!cmView) return;
        const cursorOffset = cmView.state.selection.main.head;
        const blocks = parseCodeBlocks(cmView.state.doc);
        const target = blocks.find(
          (b) => cursorOffset >= b.from && cursorOffset <= b.to
        );
        if (target) {
          cmView.dispatch({
            effects: toggleFoldEffect.of({ pos: target.from }),
          });
        } else {
          new Notice("当前光标不在代码块内");
        }
      },
    });

    // 4. 注册插件设置面板
    this.addSettingTab(new CodeBlockFolderSettingTab(this.app, this));
  }

  setAllCodeBlocksFold(collapsed: boolean) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const cmView = (view.editor as any)?.cm as EditorView | undefined;
    if (cmView) {
      cmView.dispatch({
        effects: setAllFoldEffect.of({ collapsed }),
      });
    }

    const previewEl = view.previewMode?.containerEl;
    if (previewEl) {
      const pres = previewEl.querySelectorAll<HTMLPreElement>(
        "pre.cbf-reading-pre"
      );
      pres.forEach((pre) => {
        pre.classList.toggle("is-collapsed", collapsed);
        const controls = pre.querySelector<HTMLElement>(".cbf-controls");
        if (controls) {
          controls.classList.toggle("is-collapsed", collapsed);
          controls.setAttribute("aria-expanded", collapsed ? "false" : "true");
        }
      });
    }
  }

  refreshAllEditors() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const cmView = (leaf.view.editor as any)?.cm as EditorView | undefined;
        if (cmView) {
          cmView.dispatch({
            effects: refreshSettingsEffect.of(),
          });
        }
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshAllEditors();
  }
}

// ============================================================================
// 6. 插件设置面板 UI
// ============================================================================

class CodeBlockFolderSettingTab extends PluginSettingTab {
  plugin: CodeBlockFolderPlugin;

  constructor(app: App, plugin: CodeBlockFolderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Code Block Folder - 代码块折叠设置" });

    new Setting(containerEl)
      .setName("默认折叠所有代码块")
      .setDesc("开启后，打开笔记时所有代码块默认处于收起状态（仅保留顶部栏）。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.defaultFoldAll)
          .onChange(async (value) => {
            this.plugin.settings.defaultFoldAll = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("按代码行数自动折叠")
      .setDesc("开启后，当代码块的内容超过下方设定的行数阈值时，将自动折叠。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoFoldByLineCount)
          .onChange(async (value) => {
            this.plugin.settings.autoFoldByLineCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动折叠行数阈值")
      .setDesc("当代码块达到或超过此行数时触发自动折叠（默认 15 行）。")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(String(this.plugin.settings.autoFoldThreshold))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.autoFoldThreshold = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
