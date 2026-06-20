import os

ts_code = '''import { Plugin, WorkspaceLeaf, ItemView, TFile, setIcon } from "obsidian";

const VIEW_TYPE_TODO_PANEL = "todo-panel-view";

interface PriorityDef {
  value: string;
  color: string;
}

interface StatusDef {
  value: string;
  icon: string;
}

interface TaskNotesConfig {
  customPriorities?: PriorityDef[];
  customStatuses?: StatusDef[];
}

interface TaskItem {
  title: string;
  priority: string;
  dateModified: string;
  path: string;
  status: string;
}

class TodoPanelView extends ItemView {
  plugin: TodoPanelPlugin;
  expandedPaths: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: TodoPanelPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_TODO_PANEL; }
  getDisplayText(): string { return "Todo Panel"; }
  getIcon(): string { return "checkmark"; }

  async onOpen() { this.render(); }
  async onClose() {}

  render() {
    const container = this.containerEl.children[1];
    const scrollTop = container.scrollTop;
    container.empty();
    container.addClass("todo-panel-container");

    const tasks = this.collectTasks();
    const list = container.createDiv("todo-panel-list");
    const cfg = this.plugin.taskNotesConfig;

    for (const task of tasks) {
      const wrapper = list.createDiv("todo-card-wrapper");

      const row = wrapper.createDiv("todo-card-row");
      row.addEventListener("click", () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) {
          this.plugin.app.workspace.getLeaf(false).openFile(file);
        }
      });

      const iconEl = row.createSpan("todo-icon");
      const iconName = this.getStatusIcon(task.status, cfg);
      if (iconName) {
        setIcon(iconEl, iconName.replace(/^lucide-/, "") as any);
      }

      const dot = row.createSpan("todo-priority-dot");
      const priColor = this.getPriorityColor(task.priority, cfg);
      if (priColor) {
        dot.style.setProperty("--todo-pri-color", priColor);
      }

      row.createSpan({ text: task.title, cls: "todo-title" });

      const isExpanded = this.expandedPaths.has(task.path);
      const chevron = row.createSpan("todo-chevron");
      setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
      chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.expandedPaths.has(task.path)) {
          this.expandedPaths.delete(task.path);
        } else {
          this.expandedPaths.add(task.path);
        }
        this.render();
      });

      if (isExpanded) {
        const subEl = wrapper.createDiv("todo-subtask");
        this.buildSubtaskArea(subEl, task.path);
      }
    }

    if (tasks.length === 0) {
      list.createEl("p", { text: "No tasks in progress", cls: "todo-panel-empty" });
    }

    container.createDiv("todo-panel-version").createSpan({
      text: "v" + this.plugin.manifest.version,
    });

    container.scrollTop = scrollTop;
  }

  async buildSubtaskArea(el: HTMLElement, filePath: string) {
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split("\\n");
    let firstLineIdx = -1;
    let firstText = "";
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\\s*- \\[ \\] (.+)/);
      if (match) {
        firstLineIdx = i;
        firstText = match[1].trim();
        break;
      }
    }

    if (firstLineIdx === -1) {
      this.buildSubtaskInput(el, file);
    } else {
      this.buildSubtaskRow(el, file, firstText, firstLineIdx);
    }
  }

  buildSubtaskRow(el: HTMLElement, file: TFile, text: string, lineIdx: number) {
    el.addClass("todo-subtask-row");

    const cb = el.createSpan("todo-subtask-checkbox");
    setIcon(cb, "circle");
    cb.addEventListener("click", async (e: Event) => {
      e.stopPropagation();
      cb.empty();
      setIcon(cb, "check-circle");
      cb.addClass("is-done");
      await this.plugin.app.vault.process(file, (data: string) => {
        const lines = data.split("\\n");
        if (lineIdx < lines.length) {
          lines[lineIdx] = lines[lineIdx].replace(/^(\\s*- )\\[ \\]/, "$1[x]");
        }
        return lines.join("\\n");
      });
      setTimeout(async () => {
        el.empty();
        el.removeClass("todo-subtask-row");
        await this.buildSubtaskArea(el, file.path);
      }, 150);
    });

    const span = el.createSpan({ cls: "todo-subtask-text" });
    span.setAttr("contenteditable", "true");
    span.setText(text);

    let oldText = text;
    const syncToFile = async () => {
      const newText = span.getText().trim();
      if (!newText || newText === oldText) return;
      await (file as TFile).vault.process(file, (data: string) => {
        const lines = data.split("\\n");
        if (lineIdx < lines.length) {
          lines[lineIdx] = lines[lineIdx].replace(/(- \\[ \\] ).+/, "$1" + newText);
        }
        return lines.join("\\n");
      });
      oldText = newText;
    };

    span.addEventListener("blur", () => { syncToFile(); });
    span.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        span.blur();
      }
    });
  }

  buildSubtaskInput(el: HTMLElement, file: TFile) {
    const input = el.createEl("input", {
      type: "text",
      placeholder: "Add subtask...",
      cls: "todo-subtask-input",
    });
    setTimeout(() => input.focus(), 0);
    input.addEventListener("keydown", async (e: KeyboardEvent) => {
      if (e.key === "Enter" && input.value.trim()) {
        const text = input.value.trim();
        await this.plugin.app.vault.process(file, (data: string) => {
          return data.trimEnd() + "\\n- [ ] " + text + "\\n";
        });
        el.empty();
        await this.buildSubtaskArea(el, file.path);
      }
    });
  }

  getStatusIcon(status: string, cfg: TaskNotesConfig | null): string | null {
    if (!cfg || !cfg.customStatuses) return null;
    const found = cfg.customStatuses.find(s => s.value === status);
    return found ? found.icon : null;
  }

  getPriorityColor(priority: string, cfg: TaskNotesConfig | null): string | null {
    if (!cfg || !cfg.customPriorities) return null;
    const found = cfg.customPriorities.find(p => p.value === priority);
    return found ? found.color : null;
  }

  collectTasks(): TaskItem[] {
    const results: TaskItem[] = [];
    const files = this.plugin.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache || !cache.frontmatter) continue;

      const fm = cache.frontmatter as Record<string, unknown>;
      if (fm.status !== "in-progress") continue;

      const tags: string[] = (fm.tags as string[]) || [];
      if (tags.includes("archived")) continue;

      const title = (fm.title as string) || file.basename;
      const priority = (fm.priority as string) || "";
      const dateModified = (fm.dateModified as string) || "";
      const status = (fm.status as string) || "";

      results.push({ title, priority, dateModified, path: file.path, status });
    }

    results.sort((a, b) => b.dateModified.localeCompare(a.dateModified));
    return results;
  }
}

export default class TodoPanelPlugin extends Plugin {
  taskNotesConfig: TaskNotesConfig | null = null;

  async onload() {
    this.taskNotesConfig = await this.loadTaskNotesConfig();

    this.registerView(VIEW_TYPE_TODO_PANEL, (leaf) => new TodoPanelView(leaf, this));

    this.addRibbonIcon("checkmark", "Open Todo Panel", () => this.activateView());

    this.addCommand({
      id: "open-todo-panel",
      name: "Open Todo Panel",
      callback: () => this.activateView(),
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.refreshView())
    );
  }

  async loadTaskNotesConfig(): Promise<TaskNotesConfig | null> {
    try {
      const adapter = this.app.vault.adapter;
      const dataPath = ".obsidian/plugins/tasknotes/data.json";
      if (!(await adapter.exists(dataPath))) return null;
      const raw = await adapter.read(dataPath);
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_TODO_PANEL, active: true });
      }
    }

    if (leaf) workspace.revealLeaf(leaf);
  }

  refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL);
    for (const leaf of leaves) {
      if (leaf.view instanceof TodoPanelView) leaf.view.render();
    }
  }

  onunload() {}
}
'''

with open('/tmp/obsidian-todo-panel/src/main.ts', 'w', encoding='utf-8') as f:
    f.write(ts_code)
print("main.ts written OK")
