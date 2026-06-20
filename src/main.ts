import { Plugin, WorkspaceLeaf, ItemView, TFile, setIcon } from "obsidian";

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
    container.empty();
    container.addClass("todo-panel-container");

    const tasks = this.collectTasks();
    const list = container.createDiv("todo-panel-list");
    const cfg = this.plugin.taskNotesConfig;

    for (const task of tasks) {
      const card = list.createDiv("todo-card");
      card.addEventListener("click", () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) {
          this.plugin.app.workspace.getLeaf(false).openFile(file);
        }
      });

      // status icon
      const iconEl = card.createSpan("todo-icon");
      const iconName = this.getStatusIcon(task.status, cfg);
      if (iconName) {
        const lucideName = iconName.replace(/^lucide-/, "");
        setIcon(iconEl, lucideName as any);
      }

      // priority dot
      const dot = card.createSpan("todo-priority-dot");
      const priColor = this.getPriorityColor(task.priority, cfg);
      if (priColor) {
        dot.style.setProperty("--todo-pri-color", priColor);
      }

      // title
      card.createSpan({ text: task.title, cls: "todo-title" });
    }

    container.createDiv("todo-panel-version").createSpan({
      text: `v${this.plugin.manifest.version}`,
    });
  }

  getStatusIcon(status: string, cfg: TaskNotesConfig | null): string | null {
    if (!cfg?.customStatuses) return null;
    const found = cfg.customStatuses.find(s => s.value === status);
    return found?.icon ?? null;
  }

  getPriorityColor(priority: string, cfg: TaskNotesConfig | null): string | null {
    if (!cfg?.customPriorities) return null;
    const found = cfg.customPriorities.find(p => p.value === priority);
    return found?.color ?? null;
  }

  collectTasks(): TaskItem[] {
    const results: TaskItem[] = [];
    const files = this.plugin.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;

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
