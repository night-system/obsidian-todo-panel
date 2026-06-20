import { Plugin, WorkspaceLeaf, ItemView, TFile, setIcon } from "obsidian";

const VIEW_TYPE_TODO_PANEL = "todo-panel-view";


interface PriorityDef { value: string; color: string; }
interface StatusDef { value: string; icon: string; }
interface TaskNotesConfig {
  customPriorities?: PriorityDef[];
  customStatuses?: StatusDef[];
}
interface TaskItem {
  title: string; priority: string; dateModified: string;
  path: string; status: string;
}

class TodoPanelView extends ItemView {
  plugin: TodoPanelPlugin;
  expandedPaths: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: TodoPanelPlugin) {
    super(leaf); this.plugin = plugin;
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
      if (iconName) setIcon(iconEl, iconName.replace(/^lucide-/, "") as any);

      const dot = row.createSpan("todo-priority-dot");
      const priColor = this.getPriorityColor(task.priority, cfg);
      if (priColor) dot.style.setProperty("--todo-pri-color", priColor);

      row.createSpan({ text: task.title, cls: "todo-title" });

      const isExpanded = this.expandedPaths.has(task.path);
      const chevron = row.createSpan("todo-chevron");
      setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");
      chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.expandedPaths.has(task.path))
          this.expandedPaths.delete(task.path);
        else
          this.expandedPaths.add(task.path);
        this.render();
      });

      if (isExpanded) {
        const subEl = wrapper.createDiv("todo-subtask");
        subEl.style.paddingLeft = "25.5px";
        this.buildSubtaskArea(subEl, task.path);
      }
    }

    if (tasks.length === 0)
      list.createEl("p", { text: "No tasks in progress", cls: "todo-panel-empty" });

    container.scrollTop = scrollTop;
  }

  async buildSubtaskArea(el: HTMLElement, filePath: string) {
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;
    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split("\n");
    let idx = -1, txt = "";
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*- \[ \] (.+)/);
      if (m) { idx = i; txt = m[1].trim(); break; }
    }
    this.buildSubtaskRow(el, file, idx === -1 ? "" : txt, idx);
  }

  // single unified widget: circle + contenteditable span
  buildSubtaskRow(el: HTMLElement, file: TFile, text: string, lineIdx: number) {
    el.addClass("todo-subtask-row");

    const hasTask = lineIdx >= 0;

    const cb = el.createSpan("todo-subtask-checkbox");
    setIcon(cb, "circle");

    if (hasTask) {
      cb.addEventListener("click", async (e: Event) => {
        e.stopPropagation();
        cb.empty(); setIcon(cb, "check-circle"); cb.addClass("is-done");
        await this.plugin.app.vault.process(file, (data: string) => {
          const ls = data.split("\n");
          if (lineIdx < ls.length)
            ls[lineIdx] = ls[lineIdx].replace(/^(\s*- )\[ \]/, "$1[x]");
          return ls.join("\n");
        });
        setTimeout(async () => {
          el.empty(); el.removeClass("todo-subtask-row");
          await this.buildSubtaskArea(el, file.path);
        }, 150);
      });
    }

    const span = el.createSpan({ cls: "todo-subtask-text" });
    span.setAttr("contenteditable", "true");
    span.setAttr("data-placeholder", "添加子任务");
    span.setText(text);

    if (!hasTask) {
      setTimeout(() => span.focus(), 0);
    }

    let oldText = text;
    span.addEventListener("blur", async () => {
      const nt = span.getText().trim();
      if (nt === oldText) return;
      if (!nt) { oldText = ""; return; }

      if (hasTask) {
        await (file as TFile).vault.process(file, (data: string) => {
          const ls = data.split("\n");
          if (lineIdx < ls.length)
            ls[lineIdx] = ls[lineIdx].replace(/(- \[ \] ).+/, "$1" + nt);
          return ls.join("\n");
        });
      } else {
        await this.plugin.app.vault.process(file, (data: string) =>
          data.trimEnd() + "\n- [ ] " + nt + "\n");
        el.empty(); el.removeClass("todo-subtask-row");
        await this.buildSubtaskArea(el, file.path);
      }
      oldText = nt;
    });

    span.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); span.blur(); }
    });
  }

  getStatusIcon(status: string, cfg: TaskNotesConfig | null): string | null {
    if (!cfg?.customStatuses) return null;
    const f = cfg.customStatuses.find(s => s.value === status);
    return f?.icon ?? null;
  }
  getPriorityColor(p: string, cfg: TaskNotesConfig | null): string | null {
    if (!cfg?.customPriorities) return null;
    const f = cfg.customPriorities.find(x => x.value === p);
    return f?.color ?? null;
  }

  collectTasks(): TaskItem[] {
    const r: TaskItem[] = [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      const fm = cache.frontmatter as Record<string, unknown>;
      if (fm.status !== "in-progress") continue;
      const tags: string[] = (fm.tags as string[]) || [];
      if (tags.includes("archived")) continue;
      r.push({
        title: (fm.title as string) || file.basename,
        priority: (fm.priority as string) || "",
        dateModified: (fm.dateModified as string) || "",
        path: file.path,
        status: (fm.status as string) || "",
      });
    }
    r.sort((a, b) => b.dateModified.localeCompare(a.dateModified));
    return r;
  }
}

export default class TodoPanelPlugin extends Plugin {
  taskNotesConfig: TaskNotesConfig | null = null;

  async onload() {
    this.taskNotesConfig = await this.loadTaskNotesConfig();
    this.registerView(VIEW_TYPE_TODO_PANEL, (leaf) => new TodoPanelView(leaf, this));
    this.addRibbonIcon("checkmark", "Open Todo Panel", () => this.activateView());
    this.addCommand({ id: "open-todo-panel", name: "Open Todo Panel", callback: () => this.activateView() });
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshView()));
  }

  async loadTaskNotesConfig(): Promise<TaskNotesConfig | null> {
    try {
      const a = this.app.vault.adapter;
      const dp = ".obsidian/plugins/tasknotes/data.json";
      if (!(await a.exists(dp))) return null;
      return JSON.parse(await a.read(dp));
    } catch { return null; }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL);
    if (leaves.length > 0) { leaf = leaves[0]; }
    else { leaf = workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE_TODO_PANEL, active: true }); }
    if (leaf) workspace.revealLeaf(leaf);
  }

  refreshView() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL))
      if (leaf.view instanceof TodoPanelView) leaf.view.render();
  }

  onunload() {}
}
