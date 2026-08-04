// 金海豚看板 · 静态版（Git Pages）
// 数据源: data/latest.json + data/series.json + data/ranks.json
// 功能: KPI / 热度走势 / 排名走势 / 各榜前十排名走势 / 全量榜单 / 时间范围 / 深浅主题
const state = {
  q: "",
  type: "all",
  sort: "zan",
  order: "desc",
  trendName: null,
  trendChart: null,
  rankChart: null,
  range: "24h", // 24h | 7d | 30d | all | custom
  from: null,  // ISO
  to: null,    // ISO
  latest: null,
  series: null,
  ranks: null,
};

const $ = (sel) => document.querySelector(sel);
async function loadJSON(p) {
  const res = await fetch(p + "?_=" + Date.now());
  if (!res.ok) throw new Error(`读不到 ${p}（HTTP ${res.status}）`);
  return res.json();
}

function formatNum(n) { return Number(n || 0).toLocaleString("zh-CN"); }
function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length === 19 ? iso + "+08:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}
function formatShortTime(iso) {
  const d = new Date(iso.length === 19 ? iso + "+08:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
}
function escapeHtml(str) {
  return String(str ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function setStatus(text, kind = "") {
  const el = $("#statusPill");
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

// —— 时间范围过滤：返回应展示的 ts 索引子集 ——
function currentRangeIdxs() {
  const ts = state.series.ts;
  const all = ts.map((_, i) => i);
  const last = ts.length - 1;
  if (state.range === "all") return all;
  const now = last >= 0 ? new Date(ts[last].length === 19 ? ts[last] + "+08:00" : ts[last]).getTime() : Date.now();
  if (state.range === "custom" && state.from && state.to) {
    const f = new Date(state.from).getTime();
    const t = new Date(state.to).getTime();
    return ts.map((s, i) => ({ i, t: new Date(s.length === 19 ? s + "+08:00" : s).getTime() }))
      .filter((x) => x.t >= f && x.t <= t).map((x) => x.i);
  }
  const hours = state.range === "24h" ? 24 : state.range === "7d" ? 168 : 720;
  const cutoff = now - hours * 3600 * 1000;
  return ts.map((s, i) => ({ i, t: new Date(s.length === 19 ? s + "+08:00" : s).getTime() }))
    .filter((x) => x.t >= cutoff).map((x) => x.i);
}
// 把索引子集应用到 arrays（labels/数据数组）
function sliceBy(arr, idxs) { return idxs.map((i) => arr[i]); }

function chartBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { labels: { color: "#8b98a8", boxWidth: 12, font: { family: "IBM Plex Sans" } } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatNum(c.raw)}` } },
    },
    scales: {
      x: { ticks: { color: "#8b98a8", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { color: "rgba(232,238,245,0.06)" } },
      y: { ticks: { color: "#8b98a8", callback: (v) => formatNum(v) }, grid: { color: "rgba(232,238,245,0.06)" } },
    },
  };
}
// 排名图专用（y 轴倒序，刻度 #1 #10...）
function rankScale() {
  return {
    ...chartBase().scales,
    y: {
      ...chartBase().scales.y,
      reverse: true,
      afterBuildTicks: (axis) => {
        const max = Math.floor(axis.max || 1);
        const ticks = [{ value: 1 }];
        for (let v = 10; v <= max; v += 10) ticks.push({ value: v });
        if (ticks[ticks.length - 1].value < max) ticks.push({ value: max });
        axis.ticks = ticks;
      },
      ticks: { color: "#8b98a8", autoSkip: false, callback: (v) => `#${v}` },
    },
  };
}

// —— KPI ——
function renderOverview() {
  const L = state.latest;
  const delta = L.totalDelta;
  const deltaCls = delta > 0 ? "up" : delta < 0 ? "down" : "zero";
  const deltaArrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "·";
  const deltaHtml = delta == null ? "—" : `${deltaArrow} ${delta > 0 ? "+" : ""}${formatNum(delta)}`;
  const prevLabel = L.prevTs ? formatShortTime(L.prevTs) : "—";
  $("#overviewKpis").innerHTML = `
    <div class="kpi total"><div class="label">参赛作品总数</div><div class="value">${formatNum(L.total)}</div></div>
    <div class="kpi pc-count"><div class="label">PC 作品</div><div class="value">${formatNum(L.pcCount)}</div></div>
    <div class="kpi mobile-count"><div class="label">手游作品</div><div class="value">${formatNum(L.mobileCount)}</div></div>
    <div class="kpi zan"><div class="label">总热度</div><div class="value">${formatNum(L.totalZan)}</div></div>
    <div class="kpi delta"><div class="label">总涨幅 · 较 ${prevLabel}</div><div class="value delta-${deltaCls}">${deltaHtml}</div></div>
  `;
}

// —— 榜单行 ——
function renderRows(games) {
  const tbody = $("#totalBody");
  $("#totalCount").textContent = `${games.length} 部`;
  if (!games.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty">暂无匹配结果</div></td></tr>`; return; }
  tbody.innerHTML = games.map((g, idx) => {
    const diff = g.zan - g.zanPre;
    const rankClass = idx < 3 ? "rank-top3" : "";
    const chipCls = diff > 0 ? "up" : diff < 0 ? "down" : "zero";
    const chipArrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "·";
    const diffHtml = g.zanPre > 0
      ? `<span class="delta-chip ${chipCls}">${chipArrow} ${diff > 0 ? "+" : ""}${formatNum(diff)}</span>`
      : `<span class="delta-chip zero">· —</span>`;
    return `
      <tr data-name="${escapeHtml(g.name)}">
        <td class="${rankClass}">${idx + 1}</td>
        <td>
          <div class="game-cell">
            <div class="thumb-cell">${g.img ? `<img src="${escapeHtml(g.img)}" loading="lazy">` : "🎮"}</div>
            <div class="name-cell">
              <strong><a href="javascript:;" class="game-link trend-link" title="查看热度/排名走势">${escapeHtml(g.name)}</a></strong>
              <span>${escapeHtml(g.intro || "暂无简介")} · ID ${escapeHtml(g.gid || "—")}</span>
            </div>
          </div>
        </td>
        <td>${(g.types || []).map((t) => `<span class="tag-inline">${escapeHtml(t)}</span>`).join("")}</td>
        <td class="num zan-cell">${formatNum(g.zan)}</td>
        <td class="num">${diffHtml}</td>
      </tr>`;
  }).join("");
}

function sortGames(list) {
  const dir = state.order === "asc" ? 1 : -1;
  return [...list].sort((a, b) =>
    state.sort === "name" ? a.name.localeCompare(b.name, "zh-CN") * dir : ((a.zan || 0) - (b.zan || 0)) * dir
  );
}
function renderRanking() {
  const q = state.q.trim().toLowerCase();
  let list = state.latest.games;
  if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || (g.intro || "").toLowerCase().includes(q));
  if (state.type !== "all") list = list.filter((g) => g.types.includes(state.type));
  renderRows(sortGames(list));
}

// 根据名字找 id（优先精确同名）
function findIdByName(name) {
  if (!state.series) return null;
  const ids = Object.keys(state.series.meta).filter((id) => {
    const m = state.series.meta[id];
    return m.name === name || (m.name || "").replace(/-PC$/i, "") === name;
  });
  return ids.find((id) => state.series.meta[id].name === name) || ids[0] || null;
}

// —— 顶部作品封面模糊背景 ——
function ensureCoverBg() {
  let bg = document.querySelector(".cover-bg");
  if (!bg) { bg = document.createElement("div"); bg.className = "cover-bg"; document.body.appendChild(bg); }
  return bg;
}
function updateCoverBg(name) {
  const bg = ensureCoverBg();
  if (!state.latest || !name) { bg.style.backgroundImage = ""; bg.style.opacity = "0"; return; }
  const g = state.latest.games.find((x) => x.name === name) || state.latest.games.find((x) => (x.name || "").replace(/-PC$/i, "") === name);
  if (g && g.img) { bg.style.backgroundImage = `url("${escapeHtml(g.img)}")`; bg.style.opacity = "0.55"; }
  else { bg.style.backgroundImage = ""; bg.style.opacity = "0"; }
  // 同步更新趋势容器内的作品图标
  const thumb = $("#trendThumb");
  if (thumb) thumb.innerHTML = g && g.img ? `<img src="${escapeHtml(g.img)}" loading="lazy">` : "🎮";
}

// —— 热度走势 ——
function renderTrend(name) {
  if (!name) return;
  if (state.trendChart) state.trendChart.destroy();
  const id = findIdByName(name);
  $("#trendTitle").textContent = `${name} · 热度走势`;
  updateCoverBg(name);
  const idxs = currentRangeIdxs();
  const ts = state.series.ts;
  const labels = sliceBy(ts, idxs).map(formatShortTime);
  const zans = id ? sliceBy(state.series.series[id] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const empty = !id || !zans.length;
  const ctx = $("#trendChart").getContext("2d");
  state.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: empty ? ["暂无数据"] : labels,
      datasets: [{ label: "热度", data: empty ? [0] : zans, borderColor: "#f0b429", backgroundColor: "rgba(240,180,41,0.15)", tension: 0.35, fill: true, spanGaps: true, pointRadius: 3 }],
    },
    options: { ...chartBase(), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `热度 ${c.raw}` } } } },
  });
}

// —— 排名走势（全榜/手游/PC）——
function renderRankTrend(name) {
  if (!name) return;
  if (state.rankChart) state.rankChart.destroy();
  const id = findIdByName(name);
  const meta = id ? state.series.meta[id] : null;
  const isMobileOnly = meta && (meta.types || []).includes("手游") && !(meta.types || []).includes("PC游戏");
  $("#rankTitle").textContent = `${name} · 排名走势`;
  const idxs = currentRangeIdxs();
  const labels = sliceBy(state.ranks.ts, idxs).map(formatShortTime);
  const overall = id ? sliceBy(state.ranks.ranks[id] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const mobile = id ? sliceBy(state.ranks.mobileRanks[id] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const pc = id ? sliceBy(state.ranks.pcRanks[id] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const empty = !id || !overall.length;
  const datasets = [];
  if (!empty) {
    datasets.push({ label: "总榜排名", data: overall, borderColor: "#f0b429", backgroundColor: "transparent", tension: 0.3, fill: false, spanGaps: true, pointRadius: 3 });
    if (isMobileOnly) datasets.push({ label: "手游排名", data: mobile, borderColor: "#3ecf8e", backgroundColor: "transparent", tension: 0.3, fill: false, spanGaps: true, pointRadius: 3 });
    else datasets.push({ label: "PC 排名", data: pc, borderColor: "#6cb6ff", backgroundColor: "transparent", tension: 0.3, fill: false, spanGaps: true, pointRadius: 3 });
  }
  const ctx = $("#rankChart").getContext("2d");
  state.rankChart = new Chart(ctx, {
    type: "line",
    data: { labels: empty ? ["暂无数据"] : labels, datasets },
    options: {
      ...chartBase(),
      scales: rankScale(),
      plugins: { ...chartBase().plugins, legend: { labels: { color: "#8b98a8", boxWidth: 12 }, }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: #${c.raw}` } } },
    },
  });
}

// —— 各榜单前十排名走势 ——
const TOP_PALETTE = ["#f0b429", "#6cb6ff", "#3ecf8e", "#e87ba4", "#c8a04a", "#8a9bff", "#4ad3c0", "#ff8f5e", "#b48aff", "#7dd87d"];
const TOP_STATE = { topOverallChart: null, topMobileChart: null, topPcChart: null };

function renderTopChart(canvasId, rankKey, setName) {
  const R = state.ranks;
  const idxs = currentRangeIdxs();
  const latestIdx = Math.max(...idxs);
  // 最新时间点排名前10
  const top10 = Object.keys(R[rankKey])
    .map((id) => ({ id, r: R[rankKey][id][latestIdx] }))
    .filter((x) => x.r != null)
    .sort((a, b) => a.r - b.r)
    .slice(0, 10);
  const labels = sliceBy(R.ts, idxs).map(formatShortTime);
  const datasets = top10.map((x, i) => ({
    label: (state.series.meta[x.id] || {}).name || x.id,
    data: sliceBy(R[rankKey][x.id], idxs).map((v) => (v == null ? null : v)),
    borderColor: TOP_PALETTE[i % TOP_PALETTE.length],
    backgroundColor: "transparent",
    tension: 0.3, fill: false, spanGaps: true, pointRadius: 2, borderWidth: 1.6,
  }));
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (TOP_STATE[canvasId]) TOP_STATE[canvasId].destroy();
  const setEl = document.getElementById(setName);
  if (setEl) setEl.textContent = `${top10.length} 部`;
  TOP_STATE[canvasId] = new Chart(el.getContext("2d"), {
    type: "line",
    data: { labels: labels.length ? labels : ["暂无数据"], datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: "#8b98a8", boxWidth: 10, font: { family: "IBM Plex Sans", size: 10 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: #${c.raw}` } },
      },
      scales: rankScale(),
    },
  });
}
function renderTopRanks() {
  renderTopChart("topOverallChart", "ranks", "overallTopCount");
  renderTopChart("topMobileChart", "mobileRanks", "mobileTopCount");
  renderTopChart("topPcChart", "pcRanks", "pcTopCount");
}

// —— 主题切换 ——
function initTheme() {
  const saved = localStorage.getItem("jht-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  $("#themeToggle").textContent = saved === "dark" ? "🌙" : "☀️";
  $("#themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("jht-theme", next);
    $("#themeToggle").textContent = next === "dark" ? "🌙" : "☀️";
  });
}

// —— 初始化 + 刷新 ——
async function refreshAll() {
  const [latest, series, ranks] = await Promise.all([
    loadJSON("data/latest.json"), loadJSON("data/series.json"), loadJSON("data/ranks.json"),
  ]);
  state.latest = latest; state.series = series; state.ranks = ranks;
  const sliced = currentRangeIdxs();
  const shown = sliced.length;
  setStatus(`就绪 · ${formatTime(latest.ts)} 抓取`, "ok");
  $("#snapInfo").textContent = `${formatTime(latest.ts)} · ${latest.total} 部`;
  $("#rangeHint").textContent = shown ? `（范围内 ${shown} 个时点）` : "（范围内无数据）";
  renderOverview();
  renderRanking();
  renderTopRanks();
  if (!state.trendName && latest.games[0]) {
    state.trendName = latest.games.sort((a, b) => b.zan - a.zan)[0].name;
  }
  renderTrend(state.trendName);
  renderRankTrend(state.trendName);
}

// —— 事件 ——
$("#searchInput").addEventListener("input", (e) => { state.q = e.target.value; renderRanking(); });
$("#typeSelect").addEventListener("change", (e) => { state.type = e.target.value; renderRanking(); });
$("#sortSelect").addEventListener("change", (e) => {
  const [sort, order] = $("#sortSelect").value.split(":");
  state.sort = sort; state.order = order; renderRanking();
});
$("#totalBody").addEventListener("click", (e) => {
  const link = e.target.closest(".trend-link");
  if (!link) return;
  state.trendName = link.textContent.trim();
  renderTrend(state.trendName);
  renderRankTrend(state.trendName);
});
$("#btnViewTrend").addEventListener("click", () => {
  const name = $("#trendSearch").value.trim();
  if (!name) return;
  state.trendName = name;
  renderTrend(name);
  renderRankTrend(name);
});
$("#btnVote").addEventListener("click", () => {
  const url = "https://act.3839.com/n/hykb/jinhaitun/phase1/pc/index.php";
  window.open(url, "_blank");
  setStatus("已打开投票页 · 登录后即可为把把博弈王投票", "ok");
});
// 时间范围
$("#rangeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  state.range = btn.dataset.range;
  [...$("#rangeSeg").children].forEach((b) => b.classList.toggle("active", b === btn));
  refreshAll();
});
$("#btnApplyRange").addEventListener("click", () => {
  const f = $("#fromInput").value, t = $("#toInput").value;
  if (!f || !t) { setStatus("请选择起止时间", "err"); return; }
  state.range = "custom";
  state.from = f; state.to = t;
  [...$("#rangeSeg").children].forEach((b) => b.classList.remove("active"));
  refreshAll();
});

initTheme();
refreshAll().catch((err) => setStatus(err.message, "err"));
setInterval(() => refreshAll().catch(console.error), 60_000);
