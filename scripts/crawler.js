const cheerio = require("cheerio");

const SOURCE_URL =
  "https://act.3839.com/n/hykb/jinhaitun/phase1/pc/index.php";
const AJAX_URL =
  "https://act.3839.com/n/hykb/jinhaitun/phase1/pc/ajax.php";

// 类型映射
const TYPE_MAP = {
  1: "入围游戏",
  2: "PC游戏",
  3: "手游",
  4: "学生团队",
  5: "海峡之星",
};

// 请求头（模拟浏览器）
function headers(extra = {}) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    Referer: SOURCE_URL,
    Origin: "https://act.3839.com",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    ...extra,
  };
}

async function fetchHtml(url = SOURCE_URL, { timeoutMs = 20000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { headers: headers(), signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = Math.min(1000 * attempt, 5000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * POST 调用 ajax.php 拉取指定 ids 的作品数据（无需登录）。
 * 注意：必须是 POST，GET 会返回 no_login。
 */
async function postGamePage(ids, { timeoutMs = 30000, retries = 3 } = {}) {
  const body = "ac=gamePage&ids=" + encodeURIComponent(ids.join(","));
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(AJAX_URL, {
          method: "POST",
          headers: headers(),
          body,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.key !== "ok") {
          throw new Error(`接口返回 key=${data.key} (${data.info || data.msg || ""})`);
        }
        return data.data?.list || [];
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = Math.min(1000 * attempt, 5000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * 解析页面中的 window._gameConfig（拿首屏 + 名称映射 + 全量 id 列表）
 */
function parseGameConfig(html) {
  const m = html.match(/window\._gameConfig\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/);
  if (!m) throw new Error("未找到 window._gameConfig，页面结构可能已变化");
  return Function(`"use strict"; return (${m[1]});`)();
}

/**
 * 格式化作品为统一结构
 */
function normalizeGame(g) {
  const typeIds = String(g.type || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const types = typeIds.map((t) => TYPE_MAP[t] || `类型${t}`);
  return {
    id: String(g.id),
    gid: String(g.gid || ""),
    name: g.gname || "",
    zan: Number(g.zan) || 0,       // 当前票数
    zanPre: Number(g.zan_pre) || 0, // 上次票数
    intro: g.intro || "",
    img: g.img || "",
    icon: g.icon || "",
    platform: g.platform_id || "",
    priorityShow: g.priority_show || "",
    tags: (g.tags || []).map((t) => t.title).filter(Boolean),
    types,
    typeIds,
  };
}

/**
 * 爬取金海豚全量排行榜数据（437 个作品，含票数，无需登录）
 */
async function crawlRanking() {
  // 1) 抓首屏拿全量 id 列表 + 名称映射
  const html = await fetchHtml();
  const cfg = parseGameConfig(html);
  const allIds = cfg.allIds || [];
  if (!allIds.length) throw new Error("页面中没有作品 id 列表");

  // 2) 一次 POST 拿全量数据
  const list = await postGamePage(allIds);
  if (!list.length) throw new Error("POST 拉取全量数据返回为空");

  // 3) 规范化并补充分类（nameMap 里带 -PC 后缀，typeIds 提供分类）
  const works = list.map(normalizeGame);

  // 补充：从 typeIds/nameMap 补齐分类（接口返回的 type 字段可能不全）
  const typeIdsMap = cfg.typeIds || {};
  for (const w of works) {
    const tIds = Object.keys(typeIdsMap).filter((t) =>
      (typeIdsMap[t] || []).includes(w.id)
    );
    if (tIds.length && (!w.typeIds.length || w.types.length === 0)) {
      w.typeIds = tIds;
      w.types = tIds.map((t) => TYPE_MAP[t] || `类型${t}`);
    }
    if (!w.name) {
      w.name = (cfg.nameMap || {})[w.id] || "";
    }
  }

  return {
    sourceUrl: SOURCE_URL,
    crawledAt: new Date().toISOString(),
    typeMap: TYPE_MAP,
    total: works.length,
    works,
  };
}

module.exports = {
  SOURCE_URL,
  AJAX_URL,
  TYPE_MAP,
  crawlRanking,
  parseGameConfig,
  normalizeGame,
  fetchHtml,
  postGamePage,
};
