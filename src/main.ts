import { Plugin, WorkspaceLeaf, ItemView, TFile, setIcon } from "obsidian";
import { RRule } from "rrule";

function todayStr(): string {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function todayStrDate(d: Date): string {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function parseISO8601Duration(dur: string): number {
  if (!dur) return 0;
  let ms = 0;
  const neg = dur.startsWith("-");
  const s = neg ? dur.slice(1) : dur;
  const tIdx = s.indexOf("T");
  const datePart = tIdx >= 0 ? s.slice(1, tIdx) : s.slice(1);
  const timePart = tIdx >= 0 ? s.slice(tIdx + 1) : "";

  const dMatch = datePart.match(/(\d+)D/);
  if (dMatch) ms += parseInt(dMatch[1]) * 86400000;

  const hMatch = timePart.match(/(\d+)H/);
  if (hMatch) ms += parseInt(hMatch[1]) * 3600000;
  const mMatch = timePart.match(/(\d+)M/);
  if (mMatch) ms += parseInt(mMatch[1]) * 60000;
  const sMatch = timePart.match(/(\d+)S/);
  if (sMatch) ms += parseInt(sMatch[1]) * 1000;

  return neg ? -ms : ms;
}

interface ReminderItem {
  title: string;
  description: string;
  path: string;
  notifyAt: number;
}

interface ReminderDef {
  id: string;
  type: string;
  relatedTo?: string;
  offset?: string;
  absoluteTime?: string;
  description?: string;
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
    const reminders = this.plugin.getDueReminders();

    const list = container.createDiv("todo-panel-list");
    const cfg = this.plugin.taskNotesConfig;

    if (reminders.length > 0) {
      for (const rem of reminders) {
        const row = list.createDiv("todo-reminder-row");
        row.addEventListener("click", () => {
          const file = this.plugin.app.vault.getAbstractFileByPath(rem.path);
          if (file instanceof TFile) {
            this.plugin.app.workspace.getLeaf(false).openFile(file);
          }
        });

        const bell = row.createSpan("todo-reminder-bell");
        setIcon(bell, "bell");

        row.createSpan({ text: rem.description || rem.title, cls: "todo-reminder-desc" });

        const trash = row.createSpan("todo-reminder-trash");
        setIcon(trash, "trash-2");
      }
      list.createDiv("todo-divider");
    }

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
        count.setText("\u21BB");
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

    if (tasks.length === 0 && reminders.length === 0)
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
    span.setAttr("data-placeholder", "\u6DFB\u52A0\u5B50\u4EFB\u52A1");
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
    el.createSpan({ text: "\u4ECA\u65E5\u4EFB\u52A1\u5B8C\u6210", cls: "todo-subtask-text" });
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
    const dateStr = todayStr();
    const lines = fmText.split("\n");
    const parsed: Record<string, any> = {};
    let currentKey = "";
    for (const line of lines) {
      const kv = line.match(/^(\S[\w-]*?):\s*(.*)/);
      if (kv) {
        currentKey = kv[1];
        const val = kv[2].trim();
        parsed[currentKey] = (val === "" || val === "[]") ? [] : val;
      } else {
        const li = line.match(/^\s+-\s+(.+)/);
        if (li && currentKey && Array.isArray(parsed[currentKey]))
          parsed[currentKey].push(li[1].trim());
      }
    }
    const ci: string[] = Array.isArray(parsed.complete_instances) ? [...parsed.complete_instances] : [];
    if (!ci.includes(dateStr)) ci.push(dateStr);
    const ruleStr = typeof parsed.recurrence === "string" ? parsed.recurrence : "";
    let newScheduled = "";
    let newDue = "";
    if (ruleStr) {
      try {
        const startDate = parsed.scheduled ? new Date(parsed.scheduled as string) : today;
        const opts = RRule.parseString(ruleStr);
        opts.dtstart = startDate;
        const rule = new RRule(opts);
        const next = rule.after(new Date(dateStr + "T00:00:00"), true);
        if (next) newScheduled = todayStrDate(next);
      } catch {}
    }
    const oldScheduled = typeof parsed.scheduled === "string" ? parsed.scheduled.slice(0, 10) : "";
    const oldDue = typeof parsed.due === "string" ? parsed.due.slice(0, 10) : "";
    const out: string[] = [];
    for (const k of Object.keys(parsed)) {
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
    await this.plugin.app.vault.modify(file, "---\n" + out.join("\n") + "\n---" + body);
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
    const today = todayStr();
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      const fm = cache.frontmatter as Record<string, unknown>;
      if (fm.status !== "in-progress") continue;
      const tags: string[] = (fm.tags as string[]) || [];
      if (tags.includes("archived")) continue;
      if (fm.recurrence) {
        const ci: string[] = Array.isArray(fm.complete_instances) ? (fm.complete_instances as string[]) : [];
        if (ci.includes(today)) continue;
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
  private dueReminders: ReminderItem[] = [];
  private quickCheckInterval?: number;
  private broadScanInterval?: number;
  private readonly QUICK_CHECK_MS = 30000;
  private readonly BROAD_SCAN_MS = 300000;

  async onload() {
    this.taskNotesConfig = await this.loadTaskNotesConfig();
    this.registerView(VIEW_TYPE_TODO_PANEL, (leaf) => new TodoPanelView(leaf, this));
    this.addCommand({ id: "open-todo-panel", name: "Open Todo Panel", callback: () => this.activateView() });
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshView()));
    this.registerEvent(this.app.vault.on("delete", () => this.refreshView()));

    this.scanDueReminders();
    this.quickCheckInterval = window.setInterval(() => this.scanDueReminders(), this.QUICK_CHECK_MS);
    this.broadScanInterval = window.setInterval(() => {
      this.scanDueReminders();
    }, this.BROAD_SCAN_MS);
  }

  getDueReminders(): ReminderItem[] {
    return this.dueReminders;
  }

  private scanDueReminders() {
    const now = Date.now();
    const items: ReminderItem[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      const fm = cache.frontmatter as Record<string, unknown>;
      if (fm.status !== "in-progress") continue;
      const reminders = fm.reminders;
      if (!Array.isArray(reminders) || reminders.length === 0) continue;

      for (const rem of reminders as ReminderDef[]) {
        let notifyAt = 0;

        if (rem.type === "absolute" && rem.absoluteTime) {
          notifyAt = new Date(rem.absoluteTime).getTime();
        } else if (rem.type === "relative" && rem.relatedTo && rem.offset) {
          const anchor = fm[rem.relatedTo as string];
          if (anchor && typeof anchor === "string") {
            notifyAt = new Date(anchor).getTime() + parseISO8601Duration(rem.offset);
          }
        }

        if (notifyAt > 0 && notifyAt <= now) {
          items.push({
            title: ((fm.title as string) || file.basename),
            description: rem.description || ((fm.title as string) || file.basename),
            path: file.path,
            notifyAt,
          });
        }
      }
    }

    items.sort((a, b) => a.notifyAt - b.notifyAt);
    this.dueReminders = items;
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
    this.scanDueReminders();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_PANEL))
      if (leaf.view instanceof TodoPanelView) leaf.view.render();
  }

  onunload() {
    if (this.quickCheckInterval) window.clearInterval(this.quickCheckInterval);
    if (this.broadScanInterval) window.clearInterval(this.broadScanInterval);
  }
}
