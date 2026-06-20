import { Plugin, WorkspaceLeaf, ItemView, TFile } from "obsidian";

const VIEW_TYPE_TODO_PANEL = "todo-panel-view";

interface TaskItem {
  title: string;
  priority: string;
  dateModified: string;
  path: string;
}

class TodoPanelView extends ItemView {
  plugin: TodoPanelPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TodoPanelPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TODO_PANEL;
  }

  getDisplayText(): string {
    return "Todo Panel";
  }

  getIcon(): string {
    return "checkmark";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {}

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("todo-panel-container");

    const tasks = this.collectTasks();

    const header = container.createDiv("todo-panel-header");
    header.createSpan({ text: `进行中的任务 (${tasks.length})` });

    const refreshBtn = header.createEl("button", { text: "刷新" });
    refreshBtn.addEventListener("click", () => this.render());

    const list = container.createDiv("todo-panel-list");

    if (tasks.length === 0) {
      list.createEl("p", { text: "没有进行中的任务", cls: "todo-panel-empty" });
    } else {
      for (const task of tasks) {
        const card = list.createDiv("todo-card");
        card.addEventListener("click", () => {
          const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
          if (file instanceof TFile) {
            this.plugin.app.workspace.getLeaf(false).openFile(file);
          }
        });

        const topRow = card.createDiv("todo-card-top");
        if (task.priority) {
          topRow.createSpan({
            text: task.priority,
            cls: `todo-priority todo-priority-${task.priority.toLowerCase()}`,
          });
        }
        topRow.createSpan({ text: task.title, cls: "todo-title" });

        if (task.dateModified) {
          card.createDiv("todo-card-bottom").createSpan({
            text: this.formatDate(task.dateModified),
            cls: "todo-date",
          });
        }
      }
    }

    container.createDiv("todo-panel-version").createSpan({
      text: `v${this.plugin.manifest.version}`,
    });
  }

  collectTasks(): TaskItem[] {
    const results: TaskItem[] = [];
    const files = this.plugin.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;

      const fm = cache.frontmatter as Record<string, unknown>;
      if (fm.status !== "in-progress") continue;

      const title = (fm.title as string) || file.basename;
      const priority = (fm.priority as string) || "";
      const dateModified = (fm.dateModified as string) || "";

      results.push({ title, priority, dateModified, path: file.path });
    }

    results.sort((a, b) => b.dateModified.localeCompare(a.dateModified));
    return results;
  }

  formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    } catch {
      return iso;
    }
  }
}

export default class TodoPanelPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_TODO_PANEL, (leaf) => new TodoPanelView(leaf, this));

    this.addRibbonIcon("checkmark", "Open Todo Panel", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-todo-panel",
      name: "Open Todo Panel",
      callback: () => this.activateView(),
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.refreshView();
      })
    );
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

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL);
    for (const leaf of leaves) {
      if (leaf.view instanceof TodoPanelView) {
        leaf.view.render();
      }
    }
  }

  onunload() {}
}
