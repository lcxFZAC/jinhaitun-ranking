// 金海豚看板 · 静态版（Git Pages）
// 数据源: data/latest.json（榜单+KPI）+ data/series.json（时间序列）
const state = {
  q: "",
  type: "all",
  sort: "zan",
  order: "desc",
  trendName: null,
  trendChart: null,
  latest: null, // {ts, prevTs, games, totalZan, ...}
  series: null, // {ts, series, meta}
};

const $ = (sel) => document.querySelector(sel);
async function loadJSON(p) {
  const res = await fetch(p + "?_=" + Date.now());
  if (!res.ok) throw new Error(`读不到 ${p}（HTTP ${res.status}）`);
  return res.json();
}

function formatNum(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}
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
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function setStatus(text, kind = "") {
  const el = $("#statusPill");
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

function chartBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
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

function renderRows(games) {
  const tbody = $("#totalBody");
  $("#totalCount").textContent = `${games.length} 部`;
  if (!games.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty">暂无匹配结果</div></td></tr>`;
    return;
  }
  tbody.innerHTML = games
    .map((g, idx) => {
      const diff = g.zan - g.zanPre;
      const rankClass = idx < 3 ? "rank-top3" : "";
      const chipCls = diff > 0 ? "up" : diff < 0 ? "down" : "zero";
      const chipArrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "·";
      const diffHtml =
        g.zanPre > 0
          ? `<span class="delta-chip ${chipCls}">${chipArrow} ${diff > 0 ? "+" : ""}${formatNum(diff)}</span>`
          : `<span class="delta-chip zero">· —</span>`;
      return `
        <tr data-name="${escapeHtml(g.name)}">
          <td class="${rankClass}">${idx + 1}</td>
          <td>
            <div class="game-cell">
              <div class="thumb-cell">${g.img ? `<img src="${escapeHtml(g.img)}" loading="lazy">` : "🎮"}</div>
              <div class="name-cell">
                <strong><a href="javascript:;" class="game-link trend-link" title="查看热度走势">${escapeHtml(g.name)}</a></strong>
                <span>${escapeHtml(g.intro || "暂无简介")} · ID ${escapeHtml(g.gid || "—")}</span>
              </div>
            </div>
          </td>
          <td>${(g.types || []).map((t) => `<span class="tag-inline">${escapeHtml(t)}</span>`).join("")}</td>
          <td class="num zan-cell">${formatNum(g.zan)}</td>
          <td class="num">${diffHtml}</td>
        </tr>
      `;
    })
    .join("");
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

// —— 热度走势图（从 series.json 取该作品的时间序列）——
function renderTrend(name) {
  if (!name) return;
  if (state.trendChart) state.trendChart.destroy();
  $("#trendTitle").textContent = `${name} · 热度走势`;
  // 在同名多端时优先精确同名（手游版），series.meta 里找
  const metaIds = Object.keys(state.series.meta).filter((id) => {
    const m = state.series.meta[id];
    return m.name === name || (m.name || "").replace(/-PC$/i, "") === name;
  });
  // 优先精确同名
  const exactId = metaIds.find((id) => state.series.meta[id].name === name);
  const id = exactId || metaIds[0];
  const ts = state.series.ts;
  const zans = id ? state.series.series[id] : null;
  const labels = ts.map(formatShortTime);
  const empty = !id || !zans;
  const ctx = $("#trendChart").getContext("2d");
  state.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: empty ? ["暂无数据"] : labels,
      datasets: [{
        label: "热度",
        data: empty ? [0] : zans,
        borderColor: "#f0b429",
        backgroundColor: "rgba(240,180,41,0.15)",
        tension: 0.35,
        fill: true,
        spanGaps: true,
        pointRadius: 3,
      }],
    },
    options: {
      ...chartBase(),
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `热度 ${c.raw}` } },
      },
    },
  });
}

// —— 初始化 + 刷新 ——
async function refreshAll() {
  const [latest, series] = await Promise.all([loadJSON("data/latest.json"), loadJSON("data/series.json")]);
  state.latest = latest;
  state.series = series;
  setStatus(`就绪 · ${formatTime(latest.ts)} 抓取`, "ok");
  $("#snapInfo").textContent = `${formatTime(latest.ts)} · ${latest.total} 部`;
  renderOverview();
  renderRanking();
  if (!state.trendName && latest.games[0]) {
    state.trendName = latest.games.sort((a, b) => b.zan - a.zan)[0].name;
    renderTrend(state.trendName);
  } else if (state.trendName) {
    renderTrend(state.trendName);
  }
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
});
$("#btnViewTrend").addEventListener("click", () => {
  const name = $("#trendSearch").value.trim();
  if (!name) return;
  state.trendName = name;
  renderTrend(name);
});
$("#btnVote").addEventListener("click", () => {
  const url = "https://act.3839.com/n/hykb/jinhaitun/phase1/pc/index.php";
  window.open(url, "_blank");
  setStatus("已打开投票页 · 登录后即可为把把博弈王投票", "ok");
});

refreshAll().catch((err) => setStatus(err.message, "err"));
setInterval(() => refreshAll().catch(console.error), 60_000);
