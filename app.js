(function () {
  const API_BASE = "http://localhost:8000";
  const DEFAULT_LIMIT = 10;

  const state = {
    query: "",
    algo: "bm25",
    source: "",
    page: 1,
    suggestions: [],
    suggestionIndex: -1,
    logs: [],
  };

  async function api(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlight(text, query) {
    if (!query) return text;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    let html = escapeHtml(text);
    terms.forEach((term) => {
      const re = new RegExp(`(${escapeRegExp(term)})`, "gi");
      html = html.replace(re, "<mark>$1</mark>");
    });
    return html;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatNumber(n) {
    return new Intl.NumberFormat().format(n);
  }

  function route() {
    const hash = window.location.hash.replace("#", "") || "/";
    const [path, search] = hash.split("?");
    const params = new URLSearchParams(search || "");

    if (path === "/" || path === "") {
      renderHome();
    } else if (path === "/search") {
      state.query = params.get("q") || "";
      state.algo = params.get("algo") || "bm25";
      state.source = params.get("source") || "";
      state.page = parseInt(params.get("page") || "1", 10);
      renderResults();
    } else if (path === "/analytics") {
      renderAnalytics();
    } else if (path === "/admin") {
      renderAdmin();
    } else {
      renderHome();
    }
  }

  function renderHome() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="home">
        <div class="hero-copy">
          <div class="hero-eyebrow">Live index</div>
          <h1 class="hero-title">Search across <span>Wikipedia</span>, <span>Reddit</span>, and <span>GitHub</span>.</h1>
          <p class="hero-body">Three algorithms, one interface. Toggle sources, pick a ranking method, and find what you need without leaving the terminal aesthetic.</p>
          <div class="hero-figures">
            <div class="figure-pill"><strong>3</strong> ranking algorithms</div>
            <div class="figure-pill"><strong>24h</strong> auto-reindex</div>
            <div class="figure-pill"><strong>FTS5</strong> + vector fallback</div>
          </div>
        </div>
        <div class="search-panel">
          <form class="search-box" id="search-form">
            <input
              type="text"
              id="search-input"
              class="search-input"
              placeholder="What are you looking for?"
              autocomplete="off"
              value="${escapeHtml(state.query)}"
            />
            <button type="submit" class="search-btn-main" aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
            </button>
            <ul id="autocomplete" class="autocomplete-list" hidden></ul>
          </form>
          <div class="controls">
            <div class="control-group source-toggles">
              <label id="lbl-wikipedia"><input type="checkbox" id="src-wikipedia" checked /> Wikipedia</label>
              <label id="lbl-reddit"><input type="checkbox" id="src-reddit" checked /> Reddit</label>
              <label id="lbl-github"><input type="checkbox" id="src-github" checked /> GitHub</label>
            </div>
            <div class="control-group algo-select">
              <select id="algo-select">
                <option value="bm25" ${state.algo === "bm25" ? "selected" : ""}>BM25</option>
                <option value="tfidf" ${state.algo === "tfidf" ? "selected" : ""}>TF-IDF</option>
                <option value="semantic" ${state.algo === "semantic" ? "selected" : ""}>Semantic</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
    bindSearchForm();
    updateToggleStyles();
  }

  function bindSearchForm() {
    const form = document.getElementById("search-form");
    const input = document.getElementById("search-input");
    const autocompleteEl = document.getElementById("autocomplete");
    const debounced = debounce((prefix) => fetchSuggestions(prefix), 200);

    input.addEventListener("input", (e) => {
      state.query = e.target.value;
      state.suggestionIndex = -1;
      if (state.query.length >= 2) {
        debounced(state.query);
      } else {
        autocompleteEl.hidden = true;
      }
    });

    input.addEventListener("keydown", (e) => {
      if (!autocompleteEl.hidden && state.suggestions.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          state.suggestionIndex = (state.suggestionIndex + 1) % state.suggestions.length;
          updateAutocompleteSelection();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          state.suggestionIndex = (state.suggestionIndex - 1 + state.suggestions.length) % state.suggestions.length;
          updateAutocompleteSelection();
        } else if (e.key === "Enter" && state.suggestionIndex >= 0) {
          e.preventDefault();
          input.value = state.suggestions[state.suggestionIndex];
          state.query = input.value;
          autocompleteEl.hidden = true;
          submitSearch();
        }
      }
    });

    autocompleteEl.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (li) {
        input.value = li.dataset.word;
        state.query = input.value;
        autocompleteEl.hidden = true;
        submitSearch();
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitSearch();
    });

    ["src-wikipedia", "src-reddit", "src-github"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", updateToggleStyles);
    });
  }

  function updateToggleStyles() {
    ["wikipedia", "reddit", "github"].forEach((src) => {
      const cb = document.getElementById(`src-${src}`);
      const lbl = document.getElementById(`lbl-${src}`);
      if (cb && lbl) lbl.classList.toggle("checked", cb.checked);
    });
  }

  async function fetchSuggestions(prefix) {
    const autocompleteEl = document.getElementById("autocomplete");
    try {
      const data = await api(`/autocomplete?prefix=${encodeURIComponent(prefix)}`);
      state.suggestions = data.suggestions || [];
      state.suggestionIndex = -1;
      autocompleteEl.innerHTML = state.suggestions
        .map((s) => `<li data-word="${escapeHtml(s)}">${escapeHtml(s)}</li>`)
        .join("");
      autocompleteEl.hidden = state.suggestions.length === 0;
    } catch (e) {
      autocompleteEl.hidden = true;
    }
  }

  function updateAutocompleteSelection() {
    const items = document.querySelectorAll("#autocomplete li");
    items.forEach((li, i) => li.classList.toggle("active", i === state.suggestionIndex));
  }

  function submitSearch() {
    const input = document.getElementById("search-input");
    state.query = input.value.trim();
    if (!state.query) return;
    state.algo = document.getElementById("algo-select").value;
    const source = getSelectedSource();
    state.source = source;
    state.page = 1;
    const q = new URLSearchParams({ q: state.query, algo: state.algo, page: "1" });
    if (source) q.set("source", source);
    window.location.hash = `#/search?${q.toString()}`;
  }

  function getSelectedSource() {
    const checks = [
      document.getElementById("src-wikipedia"),
      document.getElementById("src-reddit"),
      document.getElementById("src-github"),
    ];
    const selected = checks.filter((c) => c && c.checked).map((c) => c.id.replace("src-", ""));
    if (selected.length === 0 || selected.length === 3) return "";
    return selected[0];
  }

  async function renderResults() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="results-layout">
        <aside class="sidebar">
          <h3>Filters</h3>
          <div class="filter-group">
            <label>Source</label>
            <select id="filter-source">
              <option value="" ${state.source === "" ? "selected" : ""}>All sources</option>
              <option value="wikipedia" ${state.source === "wikipedia" ? "selected" : ""}>Wikipedia</option>
              <option value="reddit" ${state.source === "reddit" ? "selected" : ""}>Reddit</option>
              <option value="github" ${state.source === "github" ? "selected" : ""}>GitHub</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Algorithm</label>
            <select id="filter-algo">
              <option value="bm25" ${state.algo === "bm25" ? "selected" : ""}>BM25</option>
              <option value="tfidf" ${state.algo === "tfidf" ? "selected" : ""}>TF-IDF</option>
              <option value="semantic" ${state.algo === "semantic" ? "selected" : ""}>Semantic</option>
            </select>
          </div>
        </aside>
        <div class="results-main">
          <div class="results-header">
            <h2>${escapeHtml(state.query)}</h2>
            <div class="results-meta" id="results-meta">Loading...</div>
          </div>
          <div id="results-list"></div>
          <div id="pagination" class="pagination"></div>
        </div>
      </div>
    `;

    document.getElementById("filter-source").addEventListener("change", (e) => updateResults({ source: e.target.value }));
    document.getElementById("filter-algo").addEventListener("change", (e) => updateResults({ algo: e.target.value }));

    try {
      const params = new URLSearchParams({
        q: state.query,
        algo: state.algo,
        page: String(state.page),
        limit: String(DEFAULT_LIMIT),
      });
      if (state.source) params.set("source", state.source);
      const data = await api(`/search?${params.toString()}`);
      renderResultsList(data);
      renderPagination(data);
    } catch (e) {
      document.getElementById("results-list").innerHTML = `<div class="result-card">Error: ${escapeHtml(e.message)}</div>`;
      document.getElementById("results-meta").textContent = "";
    }
  }

  function renderResultsList(data) {
    const meta = document.getElementById("results-meta");
    meta.innerHTML = `${formatNumber(data.total || 0)} results · ${data.response_time_ms || 0}ms`;
    if (data.suggestion && data.suggestion !== data.query.toLowerCase()) {
      meta.innerHTML += `<div class="did-you-mean">Did you mean <a href="#/search?q=${encodeURIComponent(data.suggestion)}&algo=${state.algo}">${escapeHtml(data.suggestion)}</a>?</div>`;
    }

    const list = document.getElementById("results-list");
    if (!data.results || data.results.length === 0) {
      list.innerHTML = `<div class="result-card">No results found. Try a different query or source.</div>`;
      return;
    }

    list.innerHTML = data.results
      .map((r, i) => {
        const pos = (state.page - 1) * DEFAULT_LIMIT + i + 1;
        return `
        <article class="result-card" data-url="${escapeHtml(r.url)}" data-position="${pos}" style="animation-delay: ${i * 60}ms">
          <a class="result-title" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>
          <span class="result-url">${escapeHtml(r.url)}</span>
          <div class="result-snippet">${highlight(r.snippet, state.query)}</div>
          <div class="result-footer">
            <span class="badge ${escapeHtml(r.source)}">${escapeHtml(r.source)}</span>
            <span class="score">${Number(r.score || 0).toFixed(4)}</span>
          </div>
        </article>
      `;
      })
      .join("");

    list.querySelectorAll(".result-title").forEach((a) => {
      a.addEventListener("click", (e) => {
        const card = e.target.closest(".result-card");
        trackClick(state.query, card.dataset.url, parseInt(card.dataset.position, 10));
      });
    });
  }

  function renderPagination(data) {
    const total = data.total || 0;
    const pages = Math.ceil(total / DEFAULT_LIMIT);
    const container = document.getElementById("pagination");
    if (pages <= 1) {
      container.innerHTML = "";
      return;
    }
    let html = `<button ${state.page === 1 ? "disabled" : ""} data-page="${state.page - 1}">Prev</button>`;
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= state.page - 2 && i <= state.page + 2)) {
        html += `<button class="${i === state.page ? "active" : ""}" data-page="${i}">${i}</button>`;
      } else if (i === state.page - 3 || i === state.page + 3) {
        html += `<span style="color:var(--text-dim);padding:8px 0">…</span>`;
      }
    }
    html += `<button ${state.page === pages ? "disabled" : ""} data-page="${state.page + 1}">Next</button>`;
    container.innerHTML = html;
    container.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      const page = parseInt(btn.dataset.page, 10);
      updateResults({ page });
    });
  }

  function updateResults(updates) {
    if (updates.page !== undefined) state.page = updates.page;
    if (updates.source !== undefined) state.source = updates.source;
    if (updates.algo !== undefined) state.algo = updates.algo;
    const q = new URLSearchParams({
      q: state.query,
      algo: state.algo,
      page: String(state.page),
    });
    if (state.source) q.set("source", state.source);
    window.location.hash = `#/search?${q.toString()}`;
  }

  async function trackClick(query, url, position) {
    try {
      await api("/analytics/click", {
        method: "POST",
        body: JSON.stringify({ query, url, position }),
      });
    } catch (e) {
      // silent
    }
  }

  async function renderAnalytics() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="page-header">
        <h1>Analytics</h1>
        <p>Usage metrics and search performance over the last 24 hours.</p>
      </div>
      <div class="metrics" id="metrics"></div>
      <div class="chart-grid">
        <div class="chart-card"><h3>Top Queries</h3><canvas id="chart-top-queries"></canvas></div>
        <div class="chart-card"><h3>CTR by Position</h3><canvas id="chart-ctr"></canvas></div>
        <div class="chart-card"><h3>Documents Indexed Over Time</h3><canvas id="chart-docs"></canvas></div>
      </div>
    `;

    try {
      const data = await api("/analytics");
      document.getElementById("metrics").innerHTML = `
        <div class="metric-card"><h4>Total Documents</h4><div class="value">${formatNumber(data.total_documents)}</div></div>
        <div class="metric-card"><h4>Avg Response Time</h4><div class="value">${data.average_response_time_ms}ms</div></div>
        <div class="metric-card"><h4>Top Query</h4><div class="value">${escapeHtml(data.top_queries[0]?.query || "-")}</div></div>
        <div class="metric-card"><h4>Total Clicks</h4><div class="value">${formatNumber(data.ctr_by_position.reduce((a, b) => a + b.clicks, 0))}</div></div>
      `;

      const chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#a1a1aa" } },
          x: { grid: { display: false }, ticks: { color: "#a1a1aa" } },
        },
      };

      new Chart(document.getElementById("chart-top-queries"), {
        type: "bar",
        data: {
          labels: data.top_queries.map((q) => q.query),
          datasets: [{ label: "Searches", data: data.top_queries.map((q) => q.count), backgroundColor: "#d4a373", borderRadius: 4 }],
        },
        options: chartDefaults,
      });

      new Chart(document.getElementById("chart-ctr"), {
        type: "bar",
        data: {
          labels: data.ctr_by_position.map((p) => `#${p.position}`),
          datasets: [{ label: "CTR", data: data.ctr_by_position.map((p) => p.ctr), backgroundColor: "#93c5fd", borderRadius: 4 }],
        },
        options: chartDefaults,
      });

      new Chart(document.getElementById("chart-docs"), {
        type: "line",
        data: {
          labels: data.docs_over_time.map((d) => d.day),
          datasets: [{
            label: "Documents",
            data: data.docs_over_time.map((d) => d.count),
            borderColor: "#c4b5fd",
            backgroundColor: "rgba(196,181,253,0.08)",
            fill: true,
            tension: 0.3,
          }],
        },
        options: chartDefaults,
      });
    } catch (e) {
      main.innerHTML += `<div class="result-card">Error loading analytics: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderAdmin() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="page-header">
        <h1>Admin</h1>
        <p>Trigger manual crawls and inspect indexing logs.</p>
      </div>
      <form class="admin-form" id="crawl-form">
        <label>
          Source
          <select id="crawl-source">
            <option value="wikipedia">Wikipedia</option>
            <option value="reddit">Reddit</option>
            <option value="github">GitHub</option>
            <option value="generic">Generic URL</option>
          </select>
        </label>
        <label>
          Query / URL
          <input type="text" id="crawl-query" placeholder="e.g. machine learning or https://example.com" required />
        </label>
        <label>
          Max Depth
          <input type="number" id="crawl-depth" min="0" max="5" value="2" />
        </label>
        <button type="submit" class="admin-btn">Start Crawl</button>
        <div id="crawl-result" style="margin-top:14px;color:var(--text-muted);font-size:0.9rem"></div>
      </form>
      <h3 style="margin-bottom:12px">Crawl Logs</h3>
      <ul class="log-list" id="log-list"></ul>
    `;

    document.getElementById("crawl-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const source = document.getElementById("crawl-source").value;
      const query = document.getElementById("crawl-query").value.trim();
      const depth = parseInt(document.getElementById("crawl-depth").value, 10);
      const resultEl = document.getElementById("crawl-result");
      resultEl.textContent = "Crawling...";
      try {
        const payload = source === "generic" ? { source, url: query, max_depth: depth } : { source, query, max_depth: depth };
        const data = await api("/crawl", { method: "POST", body: JSON.stringify(payload) });
        resultEl.innerHTML = `Crawled ${data.crawled_count}, inserted/updated ${data.inserted_or_updated}. <a href="#/">Reload search</a>`;
        addLog(`Crawl ${source}: ${query} → ${data.crawled_count} docs, ${data.inserted_or_updated} updated`);
      } catch (err) {
        resultEl.textContent = `Error: ${err.message}`;
        addLog(`Crawl failed ${source}: ${err.message}`);
      }
    });

    renderLogs();
  }

  function addLog(message) {
    state.logs.unshift({ time: new Date().toLocaleTimeString(), message });
    state.logs = state.logs.slice(0, 50);
    renderLogs();
  }

  function renderLogs() {
    const list = document.getElementById("log-list");
    if (!list) return;
    list.innerHTML = state.logs
      .map((l) => `<li><span>[${l.time}]</span>${escapeHtml(l.message)}</li>`)
      .join("");
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("DOMContentLoaded", route);
})();
