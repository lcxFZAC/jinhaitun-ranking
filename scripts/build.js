// build.js — 从 history.json 生成 Pages 静态数据（latest.json + series.json）
// 用法: node scripts/build.js [path/to/history.json] [outdir]
// 默认: scripts/../data/history.json → scripts/../data/
'use strict';
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const histPath = process.argv[2] || path.join(root, "data", "history.json");
const outDir = process.argv[3] || path.join(root, "data");

const db = JSON.parse(fs.readFileSync(histPath, "utf8"));
const snaps = [...db.snapshots].sort((a, b) => a.crawled_at.localeCompare(b.crawled_at));
if (!snaps.length) throw new Error("history 为空");

// —— 最新快照：榜单 + KPI ——
const latest = snaps[snaps.length - 1];
const games = latest.games.map((g) => ({
  id: String(g.id),
  gid: String(g.gid || ""),
  name: g.name || "",
  zan: Number(g.zan) || 0,
  zanPre: Number(g.zanPre) || 0,
  intro: g.intro || "",
  img: g.img || "",
  icon: g.icon || "",
  types: g.types || [],
  tags: g.tags || [],
}));
const totalZan = games.reduce((s, g) => s + g.zan, 0);
const prev = snaps[snaps.length - 2];
const prevTotalZan = prev ? prev.games.reduce((s, g) => s + (g.zan || 0), 0) : null;
const pcCount = games.filter((g) => !g.types.includes("手游")).length;
const mobileCount = games.filter((g) => g.types.includes("手游")).length;

const latestOut = {
  ts: latest.crawled_at,
  prevTs: prev ? prev.crawled_at : null,
  total: games.length,
  pcCount,
  mobileCount,
  totalZan,
  totalDelta: prevTotalZan != null ? totalZan - prevTotalZan : null,
  games,
};
fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(latestOut));
console.log(`✔ latest.json  ${games.length}款 ts=${latest.crawled_at} 总热度=${totalZan} 涨幅=${latestOut.totalDelta}`);

// —— 时间序列：每作品 ts 对齐的 zan 数组 ——
const ts = snaps.map((s) => s.crawled_at);
// 按 id 聚合（含名字/图等展示字段，取最新快照的）
const series = {};
const meta = {};
for (const snap of snaps) {
  for (const g of snap.games) {
    const id = String(g.id);
    if (!series[id]) series[id] = new Array(snaps.length).fill(null);
    const idx = ts.indexOf(snap.crawled_at);
    if (idx >= 0) series[id][idx] = Number(g.zan) || 0;
    if (!meta[id]) {
      meta[id] = {
        id,
        gid: String(g.gid || ""),
        name: g.name || "",
        img: g.img || "",
        icon: g.icon || "",
        types: g.types || [],
      };
    }
  }
}
const seriesOut = { ts, series, meta };
fs.writeFileSync(path.join(outDir, "series.json"), JSON.stringify(seriesOut));
console.log(`✔ series.json  ts点数=${ts.length} 作品数=${Object.keys(series).length}`);

// 校验
const bbLatest = games.find((g) => g.id === "437");
if (bbLatest) console.log(`  榜首: ${bbLatest.name} zan=${bbLatest.zan} 环比=${bbLatest.zan - bbLatest.zanPre}`);
console.log("✅ 构建完成");
