import { Plugin, WorkspaceLeaf, ItemView } from "obsidian";

const VIEW_TYPE_TODO_PANEL = "todo-panel-view";

class TodoPanelView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
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
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("todo-panel-container");
    container.createEl("h4", { text: "Todo Panel" });
    container.createEl("p", { text: "Your tasks will appear here." });
  }

  async onClose() {}
}

export default class TodoPanelPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_TODO_PANEL, (leaf) => new TodoPanelView(leaf));

    this.addRibbonIcon("checkmark", "Open Todo Panel", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-todo-panel",
      name: "Open Todo Panel",
      callback: () => this.activateView(),
    });
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

  onunload() {}
}
