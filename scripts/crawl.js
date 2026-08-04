// crawl.js — 抓取最新快照并写入 history.json（GitHub Actions 定时用）
// 用法: node scripts/crawl.js [path/to/history.json]
'use strict';
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const histPath = process.argv[2] || path.join(root, "data", "history.json");
const crawler = require(path.join(__dirname, "crawler.js"));

function hourKey(iso) {
  // 强制用东八区（Asia/Shanghai）整点，不依赖运行环境时区（CI 是 UTC）
  const d = new Date(iso);
  const local = new Date(d.getTime() + 8 * 3600 * 1000); // +8h
  const p = (n) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:00:00`;
}

(async () => {
  const db = fs.existsSync(histPath)
    ? JSON.parse(fs.readFileSync(histPath, "utf8"))
    : { snapshots: [] };

  // 1) 抓取最新
  const data = await crawler.crawlRanking();
  const key = hourKey(data.crawledAt);

  // 2) 用上一快照算 zanPre
  const prev = [...db.snapshots]
    .filter((s) => s.crawled_at < key)
    .sort((a, b) => (a.crawled_at < b.crawled_at ? 1 : -1))[0];
  const prevZan = prev ? new Map(prev.games.map((g) => [g.id, g.zan])) : new Map();
  const games = data.works.map((g) => ({
    ...g,
    zanPre: prevZan.get(String(g.id)) ?? 0,
  }));

  const snap = { crawled_at: key, games };
  const idx = db.snapshots.findIndex((s) => s.crawled_at === key);
  if (idx >= 0) db.snapshots[idx] = snap;
  else db.snapshots.push(snap);
  db.snapshots.sort((a, b) => a.crawled_at.localeCompare(b.crawled_at));
  if (db.snapshots.length > 720) db.snapshots = db.snapshots.slice(-720);

  fs.writeFileSync(histPath, JSON.stringify(db));
  console.log(`✔ 抓取成功 ${data.total}款 → ${key} | 历史共 ${db.snapshots.length} 快照`);
  const top = games.sort((a, b) => b.zan - a.zan)[0];
  console.log(`  榜首 ${top.name} zan=${top.zan} 环比=${top.zan - top.zanPre}`);
})().catch((e) => {
  console.error("✖ 抓取失败:", e.message);
  process.exit(1);
});
