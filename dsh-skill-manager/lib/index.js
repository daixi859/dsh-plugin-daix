// dsh-skill-manager — host 面
//
// 官方插件规范：命名导出 name/inject/Config/apply，无 default export。
// - 插件自有簿记直接使用 node:fs（官方文档明确不走沙箱 fs 服务），
//   因此读写 ~/.dsh/skills 等全局目录不受 workspace-write 沙箱限制。
// - 数据通道使用 webServer HTTP 路由（官方 extension-cookbook 推荐的面板数据通道）：
//     GET  /plugins/skill-manager/list        → { ok, groups: { global, project, builtin } }
//     POST /plugins/skill-manager/set-enabled → { path, enabled } → { ok, enabled, path }
// - 内置（bundled/custom）技能通过 ctx.skills 注册表快照只读展示，不可切换。

import { readFile, writeFile, stat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";

export const name = "skill-manager";
export const inject = ["skills"];

/** 无配置项；占位以符合官方 Config 形态。 */
export const Config = undefined;

// ── 路径解析 ────────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), ".dsh");
}

function agentsHome() {
  const env = process.env.DSH_AGENTS_HOME;
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), ".agents");
}

function joinSegments(...parts) {
  return join(...parts);
}

// ── frontmatter 解析（最小 YAML 子集：行级 key: value）──────────────────────

function parseFrontmatter(text) {
  if (typeof text !== "string" || !text.startsWith("---")) return null;
  const lines = text.split("\n");
  if (lines.length < 3) return null;
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const data = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    data[m[1]] = scalarValue(m[2].trim());
  }
  return { data, end };
}

function scalarValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** 禁用 = frontmatter 同时声明 disable-model-invocation: true 与 user-invocable: false。 */
function isDisabled(data) {
  return data["disable-model-invocation"] === true && data["user-invocable"] === false;
}

/** 在 frontmatter 块内插入/移除禁用字段，返回新文本；无合法 frontmatter 返回 null。 */
function toggleFrontmatter(text, enabled) {
  const parsed = parseFrontmatter(text);
  if (parsed === null) return null;
  const lines = text.split("\n");
  const head = lines.slice(0, parsed.end);
  const body = lines.slice(parsed.end);
  const kept = head.filter((line) => {
    const t = line.trim();
    return (
      !t.startsWith("disable-model-invocation:") &&
      !t.startsWith("user-invocable:")
    );
  });
  const next = enabled
    ? kept
    : [
        ...kept.slice(0, -1),
        "disable-model-invocation: true",
        "user-invocable: false",
        kept[kept.length - 1],
      ];
  return [...next, ...body].join("\n");
}

// ── skill 目录扫描 ──────────────────────────────────────────────────────────

async function listRootSkills(rootPath) {
  const skills = [];
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return skills; // 目录不存在或不可读 → 空
  }
  for (const entry of entries) {
    const locator =
      entry.isDirectory()
        ? joinSegments(rootPath, entry.name, "SKILL.md")
        : entry.isFile() && entry.name.endsWith(".md")
          ? joinSegments(rootPath, entry.name)
          : null;
    if (locator === null) continue;
    let info;
    try {
      info = await stat(locator);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    let text;
    try {
      text = await readFile(locator, "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(text);
    if (parsed === null) continue;
    const name = parsed.data.name;
    const description = parsed.data.description;
    if (typeof name !== "string" || name.length === 0) continue;
    if (typeof description !== "string" || description.length === 0) continue;
    skills.push({
      name,
      description,
      enabled: !isDisabled(parsed.data),
      modelInvocable: parsed.data["disable-model-invocation"] !== true,
      userInvocable: parsed.data["user-invocable"] !== false,
      source: "filesystem",
      path: locator,
    });
  }
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return skills;
}

// ── 内置（bundled/custom）技能：只读展示 ────────────────────────────────────

async function listBuiltinSkills(ctx, cwd) {
  const skillsSvc = ctx.get("skills");
  if (skillsSvc === undefined) return [];
  let scope;
  try {
    const agents = ctx.get("agents");
    if (agents !== undefined) scope = agents.roots()[0] ?? agents.list()[0];
  } catch {}
  try {
    const snapshot = await skillsSvc.snapshot({ cwd, scope });
    return snapshot.skills
      .filter((s) => s.source === "bundled" || s.source === "custom")
      .map((s) => ({
        name: s.name,
        description: s.description,
        enabled: true,
        modelInvocable: true,
        userInvocable: true,
        source: s.source,
        path: null,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

// ── HTTP 工具 ───────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── 插件主体 ────────────────────────────────────────────────────────────────

export function apply(ctx) {
  let routesRegistered = false;

  const registerRoutes = () => {
    const web = ctx.get("webServer");
    if (web === undefined) return false;
    if (routesRegistered) return true;
    routesRegistered = true;
    const disposers = [
      web.register({
        kind: "exact",
        path: "/plugins/skill-manager/list",
        handler: handleList,
      }),
      web.register({
        kind: "exact",
        path: "/plugins/skill-manager/set-enabled",
        handler: handleSetEnabled,
      }),
    ];
    ctx.effect(
      () => () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {}
        }
      },
      "skill-manager: routes",
    );
    return true;
  };

  // webServer 可能晚于本插件 apply 绑定（Service.init 异步）：首次失败时挂 internal/service 补注册。
  if (!registerRoutes()) {
    ctx.on("internal/service", (svcName) => {
      if (svcName === "webServer") registerRoutes();
    });
  }

  async function handleList(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const cwd = url.searchParams.get("cwd") || undefined;
      const groups = { global: [], project: [], builtin: [] };

      const globalRoots = [
        joinSegments(dshHome(), "skills"),
        joinSegments(agentsHome(), "skills"),
      ];
      for (const root of globalRoots) {
        for (const skill of await listRootSkills(root)) {
          if (!groups.global.some((s) => s.name === skill.name)) {
            groups.global.push(skill);
          }
        }
      }

      if (typeof cwd === "string" && cwd.length > 0) {
        const projectRoots = [
          joinSegments(cwd, ".dsh", "skills"),
          joinSegments(cwd, ".agents", "skills"),
        ];
        for (const root of projectRoots) {
          for (const skill of await listRootSkills(root)) {
            if (!groups.project.some((s) => s.name === skill.name)) {
              groups.project.push(skill);
            }
          }
        }
      }

      groups.builtin = await listBuiltinSkills(ctx, cwd);
      sendJson(res, 200, { ok: true, groups, workspacePath: cwd ?? null });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }

  async function handleSetEnabled(req, res) {
    try {
      const raw = await readBody(req);
      let args;
      try {
        args = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const path = typeof args?.path === "string" ? args.path : null;
      const enabled = typeof args?.enabled === "boolean" ? args.enabled : null;
      if (!path || enabled === null) {
        sendJson(res, 400, { ok: false, error: "invalid arguments" });
        return;
      }
      // 目录路径 → 自动补 SKILL.md
      let target = path;
      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          target = joinSegments(target, "SKILL.md");
        }
      } catch {}
      const text = await readFile(target, "utf8");
      const next = toggleFrontmatter(text, enabled);
      if (next === null) {
        sendJson(res, 400, {
          ok: false,
          error: "skill file has no YAML frontmatter",
        });
        return;
      }
      if (next !== text) {
        await writeFile(target, next, "utf8");
      }
      sendJson(res, 200, { ok: true, enabled, path: target });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }
}
