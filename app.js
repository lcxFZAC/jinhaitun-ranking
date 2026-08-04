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
        <td>${(g.types || []).join(" / ")}</td>
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

// 找同作品的所有版本（PC + 手游），返回 [{id,name,isPC,img}]
function findAllByIdsByName(name) {
  if (!state.series) return [];
  const base = (name || "").replace(/-PC$/i, "").trim();
  const out = [];
  Object.keys(state.series.meta).forEach((id) => {
    const m = state.series.meta[id];
    const mName = (m.name || "").trim();
    if (mName === name || mName.replace(/-PC$/i, "").trim() === base) {
      const isPC = /-PC$/i.test(mName) || (m.types || []).includes("PC游戏");
      out.push({ id, name: mName, isPC, img: m.img || "" });
    }
  });
  return out;
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
  const series = findAllByIdsByName(name);
  $("#trendTitle").textContent = `${name.replace(/-PC$/i, "")} · 热度走势`;
  updateCoverBg(name);
  const idxs = currentRangeIdxs();
  const ts = state.series.ts;
  const labels = sliceBy(ts, idxs).map(formatShortTime);
  // 若无匹配则退化为按原名查单条
  const items = series.length ? series : (findIdByName(name) ? [{ id: findIdByName(name), name, isPC: false }] : []);
  const datasets = items.map((it, i) => {
    const arr = sliceBy(state.series.series[it.id] || [], idxs).map((v) => (v == null ? null : v));
    const isPC = it.isPC;
    const color = isPC ? "#4d9fff" : "#f0b429";
    const label = items.length > 1 ? (isPC ? `${it.name} · PC` : `${it.name} · 手游`) : "热度";
    return {
      label,
      data: arr,
      borderColor: color,
      backgroundColor: isPC ? "rgba(77,159,255,0.12)" : "rgba(240,180,41,0.15)",
      tension: 0.35, fill: false, spanGaps: true, pointRadius: 3,
    };
  });
  const empty = !datasets.length || datasets.every((d) => !d.data.length);
  const ctx = $("#trendChart").getContext("2d");
  state.trendChart = new Chart(ctx, {
    type: "line",
    data: { labels: empty ? ["暂无数据"] : labels, datasets: empty ? [{ label: "热度", data: [0], borderColor: "#f0b429", pointRadius: 0 }] : datasets },
    options: { ...chartBase(), plugins: { legend: { display: items.length > 1 }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw} 热度` } } } },
  });
}

// —— 排名走势（全榜/手游/PC）——
function renderRankTrend(name) {
  if (!name) return;
  if (state.rankChart) state.rankChart.destroy();
  const versions = findAllByIdsByName(name); // 同作品所有版本
  const primary = findIdByName(name);
  const mobileVer = versions.find((v) => !v.isPC);
  const pcVer = versions.find((v) => v.isPC);
  const overallId = primary;
  const mobileId = mobileVer ? mobileVer.id : (versions.length ? versions[0].id : primary);
  const pcId = pcVer ? pcVer.id : (versions.find((v) => v.isPC) ? versions.find((v) => v.isPC).id : primary);
  $("#rankTitle").textContent = `${name.replace(/-PC$/i, "")} · 排名走势`;
  const idxs = currentRangeIdxs();
  const labels = sliceBy(state.ranks.ts, idxs).map(formatShortTime);
  const overall = overallId ? sliceBy(state.ranks.ranks[overallId] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const mobile = mobileId ? sliceBy(state.ranks.mobileRanks[mobileId] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const pc = pcId ? sliceBy(state.ranks.pcRanks[pcId] || [], idxs).map((v) => (v == null ? null : v)) : [];
  const empty = !overallId || !overall.length;
  const datasets = [];
  if (!empty) {
    datasets.push({ label: "总榜排名", data: overall, borderColor: "#f0b429", backgroundColor: "transparent", tension: 0.3, fill: false, spanGaps: true, pointRadius: 3 });
    if (mobile.length && mobile.some((v) => v != null)) datasets.push({ label: "手游排名", data: mobile, borderColor: "#3ecf8e", backgroundColor: "transparent", tension: 0.3, fill: false, spanGaps: true, pointRadius: 3 });
    // PC 单独排名曲线（PC 版存在时显示）
    if (pc.length && pc.some((v) => v != null)) datasets.push({ label: "PC 排名", data: pc, borderColor: "#6cb6ff", backgroundColor: "transparent", tension: 0.3, fill: false, spanGaps: true, pointRadius: 3 });
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

// —— 顶部轮播快讯：播报上一时段排名提升的作品 ——
function renderTicker(latest) {
  const track = $("#tickerTrack");
  if (!track || !state.ranks) return;
  const R = state.ranks;
  const n = R.ts ? R.ts.length : 0;
  const last = n - 1, prev = n - 2;
  const items = [];
  if (last >= 0 && prev >= 0) {
    const gains = [];
    Object.keys(R.ranks).forEach((id) => {
      const arr = R.ranks[id];
      const c = arr[last], p = arr[prev];
      if (c == null || p == null) return;
      const g = p - c; // 排名提升名次
      if (g > 0) {
        const gObj = (latest.games || []).find((x) => String(x.id) === id);
        gains.push({ name: gObj ? gObj.name : id, gain: g });
      }
    });
    gains.sort((a, b) => b.gain - a.gain);
    const top = gains.slice(0, 8);
    if (top.length) {
      top.forEach((g) => {
        items.push(`<div class="ticker-item"><b>${escapeHtml(g.name)}</b> 在前一个小时里面排名提升了 <span class="up">↑${g.gain}名</span></div>`);
      });
    }
  }
  if (!items.length) {
    items.push(`<div class="ticker-item">还没有作品排名上升，请支持 <b>把把博弈王</b> 喵～</div>`);
  }
  // 首尾各补一条实现无缝循环
  const first = items[0], lastItem = items[items.length - 1];
  track.innerHTML = lastItem + items.join("") + first;
  const total = items.length + 2;
  const h = 24;
  track.style.height = (total * h) + "px";
  // 用 transform 每 N 秒上移一项，循环
  let idx = 0;
  clearInterval(window._tickerTimer);
  window._tickerTimer = setInterval(() => {
    idx++;
    track.style.transition = "transform .6s ease";
    track.style.transform = `translateY(-${(idx % total) * h}px)`;
    if (idx % total === total - 1) {
      // 跳到克隆的首条后，无过渡复位到真实首条
      setTimeout(() => {
        track.style.transition = "none";
        track.style.transform = "translateY(0px)";
        idx = 0;
        setTimeout(() => { track.style.transition = "transform .6s ease"; }, 30);
      }, 650);
    }
  }, 2600);
  // 初始显示第一条
  track.style.transform = "translateY(0px)";
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
  setStatus(`就绪 · ${formatTime(latest.ts)} 更新`, "ok");
  $("#snapInfo").textContent = `${formatTime(latest.ts)} · ${latest.total} 部 · 环比较 ${formatTime(latest.prevTs)}`;
  $("#rangeHint").textContent = shown ? `（范围内 ${shown} 个时点）` : "（范围内无数据）";
  renderOverview();
  renderRanking();
  renderTopRanks();
  renderTicker(latest);
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
  closeSuggest();
});

// —— 作品名模糊搜索下拉 ——
const suggestEl = $("#trendSuggest");
const suggestInput = $("#trendSearch");
let suggestActive = -1;
let suggestList = [];
function suggestCandidates(q) {
  if (!state.latest) return [];
  const ql = q.toLowerCase().trim();
  if (!ql) return [];
  const seen = new Set();
  const out = [];
  state.latest.games.forEach((g) => {
    if (!out.length || out.length < 12) {
      const base = (g.name || "").replace(/-PC$/i, "");
      if (!seen.has(base) && (base.toLowerCase().includes(ql) || (g.intro || "").toLowerCase().includes(ql))) {
        seen.add(base);
        out.push({ name: g.name, base, types: (g.types || []).join("/"), img: g.img || "" });
      }
    }
  });
  return out;
}
function renderSuggest(list) {
  suggestList = list;
  suggestEl.innerHTML = "";
  suggestActive = -1;
  if (!list.length) {
    suggestEl.innerHTML = `<li class="s-no">无匹配作品</li>`;
    suggestEl.classList.add("open");
    return;
  }
  list.forEach((it, i) => {
    const li = document.createElement("li");
    li.dataset.index = i;
    li.innerHTML = `${it.img ? `<img src="${escapeHtml(it.img)}" loading="lazy">` : `<span class="s-ic">🎮</span>`}<span class="s-name">${escapeHtml(it.base)}</span><span class="s-type">${escapeHtml(it.types)}</span>`;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); pickSuggest(it); });
    li.addEventListener("mouseenter", () => { suggestActive = i; markActive(); });
    suggestEl.appendChild(li);
  });
  suggestEl.classList.add("open");
}
function markActive() {
  [...suggestEl.children].forEach((li, i) => li.classList.toggle("active", i === suggestActive));
}
function pickSuggest(it) {
  suggestInput.value = it.name;
  state.trendName = it.name;
  renderTrend(it.name);
  renderRankTrend(it.name);
  closeSuggest();
}
function closeSuggest() { suggestEl.classList.remove("open"); suggestEl.innerHTML = ""; suggestList = []; suggestActive = -1; }
suggestInput.addEventListener("input", () => renderSuggest(suggestCandidates(suggestInput.value)));
suggestInput.addEventListener("focus", () => { if (suggestInput.value.trim()) renderSuggest(suggestCandidates(suggestInput.value)); });
suggestInput.addEventListener("keydown", (e) => {
  const items = suggestEl.children;
  if (e.key === "ArrowDown") { e.preventDefault(); suggestActive = Math.min(suggestActive + 1, items.length - 1); markActive(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); suggestActive = Math.max(suggestActive - 1, 0); markActive(); }
  else if (e.key === "Enter") {
    if (suggestActive >= 0 && suggestList[suggestActive]) { e.preventDefault(); pickSuggest(suggestList[suggestActive]); }
  }
  else if (e.key === "Escape") closeSuggest();
});
document.addEventListener("click", (e) => { if (!e.target.closest(".trend-search-wrap")) closeSuggest(); });

// —— 作者推荐作品（广告位）点击进入游戏页 ——
document.querySelectorAll(".rec-card").forEach((card) => {
  card.addEventListener("click", (e) => {
    const link = card.dataset.link;
    if (link) { window.open(link, "_blank"); return; }
    const name = card.dataset.rec;
    if (!name) return;
    suggestInput.value = name;
    state.trendName = name;
    renderTrend(name);
    renderRankTrend(name);
    document.getElementById("trendbar").scrollIntoView({ behavior: "smooth", block: "center" });
  });
});
$("#btnVote").addEventListener("click", () => {
  const url = "https://act.3839.com/n/hykb/jinhaitun/phase1/pc/index.php";
  window.open(url, "_blank");
  setStatus("已打开投票页 · 登录后即可为把把博弈王投票", "ok");
  // 点击埋点（记录投票按钮点击次数）
  try {
    fetch("https://jhtstats.duckdns.org/click", {
      method: "POST",
      body: JSON.stringify({ action: "vote", btn: "btnVote", ref: document.referrer || "", path: location.pathname }),
      headers: { "Content-Type": "text/plain" }, keepalive: true,
    }).catch(() => {});
  } catch (e) {}
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

// —— 访问打点（方案B 统计服务）——
// 用 fetch + text/plain：text/plain 是“简单请求”，跨域不触发预检(OPTIONS)，最稳
(function () {
  try {
    const payload = { ua: navigator.userAgent, ref: document.referrer || "", path: location.pathname };
    const url = "https://jhtstats.duckdns.org/hit";
    // 主路径：fetch + text/plain（简单请求，跨域直发，避免预检）
    fetch(url, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
  } catch (e) { /* 打点失败不影响页面 */ }
})();
