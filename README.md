# Code Block Folder (Obsidian 代码块折叠插件)

一个轻量、顺滑的 Obsidian 插件，为 Markdown 代码块增加**顶部折叠控制栏**（显示编程语言与代码行数），点击即可将长代码块**完全收起为单行信息栏**，同时支持「阅读视图 (Reading View)」与「实时预览/编辑模式 (Live Preview)」。

---

## ✨ 核心功能

1. **顶部折叠控制栏**：
   - 自动识别代码块语言（如 `Python`、`JavaScript`、`TypeScript`、`SQL` 等）并统计代码总行数。
   - 点击顶部栏任意位置即可在「展开」与「单行收起」之间切换。
   - 右侧内置便捷「复制」按钮，即使在代码块折叠状态下也能一键复制完整代码。
2. **完全收起视觉效果**：
   - 折叠后完全隐藏代码块内容，仅保留一行整洁的信息栏：`▸  Python · 45 lines  [点击展开]`。
3. **双视图无缝支持**：
   - **阅读视图 (Reading View)**：基于 `MarkdownPostProcessor` 渲染。
   - **实时预览与源码模式 (Live Preview / Source Mode)**：基于 CodeMirror 6 `StateField` 与行级装饰器，编辑其他段落时自动保持已折叠代码块的折叠状态。
4. **多种自动折叠与快捷操作**：
   - **语法标记自动折叠**：在代码块首行加上 `fold` 或 `collapse`（如 ```` ```python fold ````），该代码块默认自动折叠。
   - **按行数自动折叠**：可在插件设置中开启「按代码行数自动折叠」并自定义行数阈值（默认 15 行）。
   - **全局快捷命令**（可通过 `Cmd/Ctrl + P` 调用或绑定快捷键）：
     - `折叠当前笔记中的所有代码块 (Fold all code blocks)`
     - `展开当前笔记中的所有代码块 (Unfold all code blocks)`
     - `切换当前光标所在代码块的折叠状态 (Toggle code block fold at cursor)`

---

## 🚀 安装方法（直接可用，无需编译）

本项目已包含预构建好的 `main.js`，您可以直接将插件安装到您的 Obsidian 库（Vault）中：

1. 打开您的 Obsidian 库所在的本地文件夹，进入 `.obsidian/plugins/` 目录（如果看不到 `.obsidian` 隐藏文件夹，在 macOS 下可按 `Cmd + Shift + .` 显示隐藏文件）。
2. 新建一个文件夹，命名为 `code-block-folder`。
3. 将本项目下的以下 **3 个文件** 复制到 `.obsidian/plugins/code-block-folder/` 中：
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. 打开 Obsidian -> **设置 (Settings)** -> **第三方插件 (Community plugins)**：
   - 确保已关闭「安全模式」，点击 **重新加载插件 (Reload plugins)**。
   - 在已安装插件列表中找到 **Code Block Folder** 并开启开关即可！

---

## 🛠️ 二次开发说明

如果您希望修改源码并重新打包：

```bash
npm install
# 开发模式（监听修改自动编译）
npm run dev
# 生产构建
npm run build
```
