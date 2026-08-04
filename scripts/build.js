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

// —— 昨日同时刻对比（每日对比基准）——
function yestTimeOf(ts) {
  // ts 形如 YYYY-MM-DDTHH:00:00 → 取昨天同一小时
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(ts);
  if (!m) return null;
  const d = new Date(m[1] + "T" + m[2] + ":00:00+08:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString(); // UTC
}
const latestH = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(latest.crawled_at);
const yestH = latestH ? latestH[1].slice(0, 4) + "-" + latestH[1].slice(5) : null;
// 昨天同一 HH:00 的本地日期前缀 + 小时
const yestLocal = latestH ? (() => {
  const d = new Date(`${latestH[1]}T${latestH[2]}:00:00+08:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10) + "T" + latestH[2];
})() : null;
// 找昨日同时刻快照（本地对齐：snap.crawled_at 是本地+8 字符串 YYYY-MM-DDTHH:00:00）
let yestSnap = yestLocal ? snaps.find((s) => s.crawled_at.startsWith(yestLocal)) : null;
// 若无同时刻，退回昨日最早快照
if (!yestSnap && latestH) {
  const yestDate = (() => { const d = new Date(`${latestH[1]}T00:00:00+08:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  yestSnap = snaps.find((s) => s.crawled_at.startsWith(yestDate)) || null;
}
const yestZanById = {};
if (yestSnap) yestSnap.games.forEach((g) => { yestZanById[String(g.id)] = Number(g.zan) || 0; });
const tsYest = yestSnap ? yestSnap.crawled_at : null;
// 每作品昨日热度 + 日涨幅
games.forEach((g) => {
  g.zanYest = yestZanById[g.id] != null ? yestZanById[g.id] : 0;
  g.dayDelta = g.zan - g.zanYest;
});
const totalZanYest = tsYest != null ? games.reduce((s, g) => s + g.zanYest, 0) : null;

const latestOut = {
  ts: latest.crawled_at,
  prevTs: prev ? prev.crawled_at : null,
  tsYest,
  total: games.length,
  pcCount,
  mobileCount,
  totalZan,
  totalDelta: prevTotalZan != null ? totalZan - prevTotalZan : null,
  totalZanYest,
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

// —— 排名序列：每个时间点每作品的排名（按 zan 从高到低，含手游/PC 分榜）——
// 生成: { ts, ranks:{id:[排名数组]}, mobileRanks:{id:[...]}, pcRanks:{id:[...]}, perTs:[{t, overall:[[id,rank]...], mobile:[...], pc:[...]}] }
const ranks = {};       // 全榜排名
const mobileRanks = {}; // 手游榜
const pcRanks = {};     // PC 榜
for (const id of Object.keys(series)) { ranks[id] = new Array(ts.length).fill(null); mobileRanks[id] = new Array(ts.length).fill(null); pcRanks[id] = new Array(ts.length).fill(null); }
snaps.forEach((snap, ti) => {
  const isMobile = (g) => !(g.types || []).includes("PC游戏");
  const byZan = (a, b) => (b.zan || 0) - (a.zan || 0);
  const overall = [...snap.games].sort(byZan);
  const mobile = overall.filter(isMobile);
  const pc = overall.filter((g) => !isMobile(g));
  overall.forEach((g, i) => { const id = String(g.id); if (ranks[id]) ranks[id][ti] = i + 1; });
  mobile.forEach((g, i) => { const id = String(g.id); if (mobileRanks[id]) mobileRanks[id][ti] = i + 1; });
  pc.forEach((g, i) => { const id = String(g.id); if (pcRanks[id]) pcRanks[id][ti] = i + 1; });
});
const ranksOut = { ts, ranks, mobileRanks, pcRanks };
fs.writeFileSync(path.join(outDir, "ranks.json"), JSON.stringify(ranksOut));
console.log(`✔ ranks.json  全榜/手游/PC 排名已生成`);

// 校验
const bbLatest = games.find((g) => g.id === "437");
if (bbLatest) console.log(`  榜首: ${bbLatest.name} zan=${bbLatest.zan} 环比=${bbLatest.zan - bbLatest.zanPre}`);
console.log("✅ 构建完成");
