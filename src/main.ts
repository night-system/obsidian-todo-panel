import { Plugin, WorkspaceLeaf, ItemView, TFile, setIcon, Notice } from "obsidian";
import { RRule, RRuleSet, rrulestr } from "rrule";

function dateStrToDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

const VIEW_TYPE_TODO_PANEL = "todo-panel-view";


interface PriorityDef { value: string; color: string; }
interface StatusDef { value: string; icon: string; }
interface TaskNotesConfig {
  customPriorities?: PriorityDef[];
  customStatuses?: StatusDef[];
}
interface TaskItem {
  title: string; priority: string; dateModified: string;
  path: string; status: string; subtaskCount: number;
  isRecurring: boolean;
}

class TodoPanelView extends ItemView {
  plugin: TodoPanelPlugin;
  expandedPaths: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: TodoPanelPlugin) {
    super(leaf); this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_TODO_PANEL; }
  getDisplayText(): string { return "Todo"; }
  getIcon(): string { return "git-pull-request"; }
  async onOpen() { this.render(); }
  async onClose() {}

  async render() {
    const container = this.containerEl.children[1];
    const scrollTop = container.scrollTop;
    container.empty();
    container.addClass("todo-panel-container");

    const tasks = await this.collectTasks();
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
      iconEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.expandedPaths.has(task.path))
          this.expandedPaths.delete(task.path);
        else
          this.expandedPaths.add(task.path);
        this.render();
      });

      const dot = row.createSpan("todo-priority-dot");
      const priColor = this.getPriorityColor(task.priority, cfg);
      if (priColor) dot.style.setProperty("--todo-pri-color", priColor);

      row.createSpan({ text: task.title, cls: "todo-title" });

      const isExpanded = this.expandedPaths.has(task.path);
      const count = row.createSpan("todo-count");
      if (task.isRecurring) {
        count.setText("↻");
      } else {
        count.setText(String(task.subtaskCount));
      }
      count.addEventListener("click", (e) => {
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
        if (task.isRecurring) {
          this.buildRecurringCompleteRow(subEl, task.path);
        } else {
          this.buildSubtaskArea(subEl, task.path);
        }
      }
    }

    if (tasks.length === 0)
      list.createEl("p", { text: "No tasks in progress", cls: "todo-panel-empty" });

    container.scrollTop = scrollTop;

    container.createDiv("todo-panel-version").createSpan({
      text: "v" + this.plugin.manifest.version,
    });
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

  // recurring task completion
  buildRecurringCompleteRow(el: HTMLElement, filePath: string) {
    el.addClass("todo-subtask-row");

    const cb = el.createSpan("todo-subtask-checkbox");
    setIcon(cb, "circle");
    cb.addEventListener("click", async (e: Event) => {
      e.stopPropagation();
      cb.empty(); setIcon(cb, "check-circle"); cb.addClass("is-done");
      await this.completeRecurringInstance(filePath);
      setTimeout(async () => {
        el.empty(); el.removeClass("todo-subtask-row");
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const cache = this.plugin.app.metadataCache.getFileCache(file);
          if (cache?.frontmatter) {
            const fm = cache.frontmatter as Record<string, unknown>;
            if (fm.recurrence) {
              this.buildRecurringCompleteRow(el, filePath);
              return;
            }
          }
        }
        el.empty();
      }, 150);
    });

    el.createSpan({ text: "今日任务完成", cls: "todo-subtask-text" });
  }

  async completeRecurringInstance(filePath: string) {
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const raw = await this.plugin.app.vault.read(file);
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return;

    const fmText = fmMatch[1];
    const body = raw.slice(fmMatch[0].length);
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);

    // Parse lines
    const lines = fmText.split("\n");
    const parsed: Record<string, any> = {};
    let currentKey = "";
    for (const line of lines) {
      const kv = line.match(/^(\S[\w-]*?):\s*(.*)/);
      if (kv) {
        currentKey = kv[1];
        const val = kv[2].trim();
        if (val === "" || val === "[]") {
          parsed[currentKey] = [];
        } else {
          parsed[currentKey] = val;
        }
      } else {
        const li = line.match(/^\s+-\s+(.+)/);
        if (li && currentKey && Array.isArray(parsed[currentKey])) {
          parsed[currentKey].push(li[1].trim());
        }
      }
    }

    // Add today to complete_instances
    const ci: string[] = Array.isArray(parsed.complete_instances) ? [...parsed.complete_instances] : [];
    if (!ci.includes(dateStr)) ci.push(dateStr);

    // Advance scheduled/due via rrule
    const ruleStr = typeof parsed.recurrence === "string" ? parsed.recurrence : "";
    let newScheduled = "";
    let newDue = "";
    if (ruleStr) {
      try {
        const startDate = parsed.scheduled
          ? new Date(parsed.scheduled as string)
          : today;
        const opts = RRule.parseString(ruleStr);
        opts.dtstart = startDate;
        const rule = new RRule(opts);
        const next = rule.after(dateStrToDate(dateStr), true);
        if (next) {
          newScheduled = next.toISOString().slice(0, 10);
        }
      } catch {}
    }

    const oldScheduled = typeof parsed.scheduled === "string" ? parsed.scheduled.slice(0, 10) : "";
    const oldDue = typeof parsed.due === "string" ? parsed.due.slice(0, 10) : "";

    // Rebuild YAML
    const out: string[] = [];
    const keys = Object.keys(parsed);
    for (const k of keys) {
      if (k === "complete_instances") {
        out.push("complete_instances:");
        for (const d of ci) out.push("  - " + d);
      } else if (k === "scheduled" && newScheduled) {
        out.push("scheduled: " + newScheduled);
      } else if (k === "due" && newScheduled && oldDue === oldScheduled) {
        out.push("due: " + newScheduled);
      } else if (k === "dateModified") {
        out.push("dateModified: " + today.toISOString());
      } else if (typeof parsed[k] === "string") {
        out.push(k + ": " + parsed[k]);
      } else if (Array.isArray(parsed[k]) && k !== "complete_instances") {
        out.push(k + ":");
        for (const item of parsed[k]) out.push("  - " + item);
      }
    }

    const newFm = "---\n" + out.join("\n") + "\n---";
    await this.plugin.app.vault.modify(file, newFm + body);
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
  getPriorityWeight(p: string, cfg: TaskNotesConfig | null): number {
    if (!cfg?.customPriorities) return 0;
    const f = cfg.customPriorities.find(x => x.value === p);
    return f ? (f as any).weight ?? 0 : 0;
  }

  async collectTasks(): Promise<TaskItem[]> {
    const r: TaskItem[] = [];
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      const fm = cache.frontmatter as Record<string, unknown>;
      if (fm.status !== "in-progress") continue;
      const tags: string[] = (fm.tags as string[]) || [];
      if (tags.includes("archived")) continue;
      if (fm.recurrence) {
        const ci: string[] = Array.isArray(fm.complete_instances)
          ? (fm.complete_instances as string[])
          : [];
        if (ci.includes(todayStr)) continue;
      }
      const content = await this.plugin.app.vault.cachedRead(file);
      let count = 0;
      for (const line of content.split("\n")) {
        if (/^\s*- \[ \] .+/.test(line)) count++;
      }
      r.push({
        title: (fm.title as string) || file.basename,
        priority: (fm.priority as string) || "",
        dateModified: (fm.dateModified as string) || "",
        path: file.path,
        status: (fm.status as string) || "",
        subtaskCount: count,
        isRecurring: !!(fm.recurrence as string),
      });
    }
    r.sort((a, b) => {
      const wa = this.getPriorityWeight(a.priority, this.plugin.taskNotesConfig);
      const wb = this.getPriorityWeight(b.priority, this.plugin.taskNotesConfig);
      if (wa !== wb) return wb - wa;
      return a.title.localeCompare(b.title);
    });
    return r;
  }
}

export default class TodoPanelPlugin extends Plugin {
  taskNotesConfig: TaskNotesConfig | null = null;

  async onload() {
    this.taskNotesConfig = await this.loadTaskNotesConfig();
    this.registerView(VIEW_TYPE_TODO_PANEL, (leaf) => new TodoPanelView(leaf, this));
    this.addCommand({ id: "open-todo-panel", name: "Open Todo Panel", callback: () => this.activateView() });
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshView()));
    this.registerEvent(this.app.vault.on("delete", () => this.refreshView()));
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
    else { leaf = workspace.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE_TODO_PANEL, active: true }); }
    if (leaf) workspace.revealLeaf(leaf);
  }

  refreshView() {
    // Debug: show complete_instances of recurring tasks
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      const fm = cache.frontmatter as Record<string, unknown>;
      if (!fm.recurrence) continue;
      const ci = Array.isArray(fm.complete_instances) ? fm.complete_instances : [];
      new Notice((fm.title || file.basename) + ": " + JSON.stringify(ci));
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL))
      if (leaf.view instanceof TodoPanelView) leaf.view.render();
  }

  onunload() {}
}
