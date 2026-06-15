(function () {
  const API_BASE = "http://localhost:8000";
  const DEFAULT_LIMIT = 10;

  const state = {
    query: "",
    algo: "bm25",
    source: "",
    live: false,
    page: 1,
    suggestions: [],
    suggestionIndex: -1,
    logs: [],
    traceQuery: "",
    traceAlgo: "bm25",
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
      state.live = params.get("live") === "1" || params.get("live") === "true";
      state.page = parseInt(params.get("page") || "1", 10);
      renderResults();
    } else if (path === "/analytics") {
      renderAnalytics();
    } else if (path === "/admin") {
      renderAdmin();
    } else if (path === "/trace") {
      state.traceQuery = params.get("q") || "";
      state.traceAlgo = params.get("algo") || "bm25";
      renderTrace();
    } else {
      renderHome();
    }
  }

  function renderHome() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="home">
        <div class="hero-copy span-8">
          <div class="hero-eyebrow">Live index</div>
          <h1 class="hero-title">Search across <span>Wikipedia</span>, <span>Reddit</span>, and <span>GitHub</span>.</h1>
          <p class="hero-body">Three algorithms, one interface. Toggle sources, pick a ranking method, and find what you need without leaving the terminal aesthetic.</p>
          <div class="hero-figures">
            <div class="figure-pill"><strong>3</strong> ranking algorithms</div>
            <div class="figure-pill"><strong>24h</strong> auto-reindex</div>
            <div class="figure-pill"><strong>FTS5</strong> + vector fallback</div>
          </div>
        </div>
        <div class="search-panel span-8">
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
            <div class="control-group live-toggle">
              <label><input type="checkbox" id="live-toggle" ${state.live ? "checked" : ""} /> Live crawl</label>
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
    const live = document.getElementById("live-toggle")?.checked || false;
    state.source = source;
    state.live = live;
    state.page = 1;
    const q = new URLSearchParams({ q: state.query, algo: state.algo, page: "1" });
    if (source) q.set("source", source);
    if (live) q.set("live", "1");
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
          <div class="filter-group live-toggle">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="live-toggle" ${state.live ? "checked" : ""} />
              Live crawl fallback
            </label>
            <p style="font-size:0.75rem;color:var(--text-dim);margin:6px 0 0">Auto-crawl sources if indexed results are sparse.</p>
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

    document.getElementById("live-toggle")?.addEventListener("change", (e) => updateResults({ live: e.target.checked }));

    try {
      const params = new URLSearchParams({
        q: state.query,
        algo: state.algo,
        page: String(state.page),
        limit: String(DEFAULT_LIMIT),
      });
      if (state.source) params.set("source", state.source);
      if (state.live) params.set("live", "1");
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
    let metaHtml = `${formatNumber(data.total || 0)} results · ${data.response_time_ms || 0}ms`;
    if (data.live) {
      const crawled = data.crawl_info?.crawled_count ?? 0;
      const inserted = data.crawl_info?.inserted_or_updated ?? 0;
      const err = data.crawl_info?.error;
      if (err) {
        metaHtml += ` · <span style="color:var(--text-dim)">Live crawl failed</span>`;
      } else if (crawled > 0) {
        metaHtml += ` · <span style="color:var(--accent)">Live crawl: ${crawled} crawled, ${inserted} indexed</span>`;
      } else {
        metaHtml += ` · <span style="color:var(--text-dim)">Live search enabled</span>`;
      }
    }
    meta.innerHTML = metaHtml;
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
    if (updates.live !== undefined) state.live = updates.live;
    const q = new URLSearchParams({
      q: state.query,
      algo: state.algo,
      page: String(state.page),
    });
    if (state.source) q.set("source", state.source);
    if (state.live) q.set("live", "1");
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
          y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { color: "#52525b" } },
          x: { grid: { display: false }, ticks: { color: "#52525b" } },
        },
      };

      new Chart(document.getElementById("chart-top-queries"), {
        type: "bar",
        data: {
          labels: data.top_queries.map((q) => q.query),
          datasets: [{ label: "Searches", data: data.top_queries.map((q) => q.count), backgroundColor: "#dc2626", borderRadius: 4 }],
        },
        options: chartDefaults,
      });

      new Chart(document.getElementById("chart-ctr"), {
        type: "bar",
        data: {
          labels: data.ctr_by_position.map((p) => `#${p.position}`),
          datasets: [{ label: "CTR", data: data.ctr_by_position.map((p) => p.ctr), backgroundColor: "#dc2626", borderRadius: 4 }],
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
            borderColor: "#dc2626",
            backgroundColor: "rgba(220,38,38,0.12)",
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

  function renderTrace() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="page-header">
        <h1>Search Trace</h1>
        <p>See how BM25, TF-IDF, or semantic search scores and ranks documents in real time.</p>
      </div>
      <div class="trace-form">
        <div class="trace-field">
          <label>Query</label>
          <input type="text" id="trace-input" class="trace-input" placeholder="e.g. python programming" value="${escapeHtml(state.traceQuery)}" />
        </div>
        <div class="trace-field">
          <label>Algorithm</label>
          <select id="trace-algo" class="trace-select">
            <option value="bm25" ${state.traceAlgo === "bm25" ? "selected" : ""}>BM25</option>
            <option value="tfidf" ${state.traceAlgo === "tfidf" ? "selected" : ""}>TF-IDF</option>
            <option value="semantic" ${state.traceAlgo === "semantic" ? "selected" : ""}>Semantic</option>
          </select>
        </div>
        <button id="trace-run" class="admin-btn">Run trace</button>
      </div>
      <div id="trace-output"></div>
    `;

    document.getElementById("trace-run").addEventListener("click", runTrace);
    document.getElementById("trace-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") runTrace();
    });

    if (state.traceQuery) {
      runTrace();
    }
  }

  async function runTrace() {
    const input = document.getElementById("trace-input");
    const algo = document.getElementById("trace-algo").value;
    state.traceQuery = input.value.trim();
    state.traceAlgo = algo;
    if (!state.traceQuery) return;

    const output = document.getElementById("trace-output");
    output.innerHTML = `<div class="trace-loading">Running trace...</div>`;

    try {
      const data = await api(`/search/trace?q=${encodeURIComponent(state.traceQuery)}&algo=${algo}&limit=5`);
      renderTraceOutput(data);
    } catch (e) {
      output.innerHTML = `<div class="result-card">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderTraceOutput(data) {
    const output = document.getElementById("trace-output");
    let steps = "";

    // Step 1: Query preprocessing
    steps += `
      <div class="trace-step" style="animation-delay:0ms">
        <div class="trace-step-header">1. Query preprocessing</div>
        <div class="trace-step-body">
          <div class="trace-pill-list">
            <div class="trace-pill"><strong>Raw:</strong> ${escapeHtml(data.query)}</div>
            <div class="trace-pill"><strong>Tokens:</strong> ${(data.tokens || []).map(escapeHtml).join(", ")}</div>
            ${data.stemmed ? `<div class="trace-pill"><strong>Stemmed:</strong> ${data.stemmed.map(escapeHtml).join(", ")}</div>` : ""}
          </div>
        </div>
      </div>
    `;

    // Step 2: Algorithm setup
    if (data.algo === "bm25") {
      steps += `
        <div class="trace-step" style="animation-delay:100ms">
          <div class="trace-step-header">2. BM25 parameters</div>
          <div class="trace-step-body">
            <div class="trace-pill-list">
              <div class="trace-pill">k1 = ${data.parameters.k1}</div>
              <div class="trace-pill">b = ${data.parameters.b}</div>
              <div class="trace-pill">avg document length = ${data.avgdl}</div>
            </div>
            <div class="trace-idf">
              <strong>IDF per query token:</strong>
              ${Object.entries(data.idf || {}).map(([t, v]) => `<span class="trace-idf-item">${escapeHtml(t)}: ${v.toFixed(4)}</span>`).join("")}
            </div>
          </div>
        </div>
      `;
    } else if (data.algo === "tfidf") {
      steps += `
        <div class="trace-step" style="animation-delay:100ms">
          <div class="trace-step-header">2. TF-IDF query vector</div>
          <div class="trace-step-body">
            <div class="trace-vector">
              ${Object.entries(data.query_vector || {}).map(([t, v]) => `<span class="trace-vector-item">${escapeHtml(t)}: ${v.toFixed(4)}</span>`).join("")}
            </div>
          </div>
        </div>
      `;
    } else if (data.algo === "semantic") {
      steps += `
        <div class="trace-step" style="animation-delay:100ms">
          <div class="trace-step-header">2. Semantic embedding</div>
          <div class="trace-step-body">
            <div class="trace-pill"><strong>Model:</strong> ${escapeHtml(data.model)}</div>
            <div class="trace-vector">
              <strong>Query embedding preview:</strong>
              ${(data.query_embedding_preview || []).map((v) => `<span class="trace-vector-item">${v}</span>`).join("")}
            </div>
          </div>
        </div>
      `;
    }

    // Step 3: Document analysis
    const docCards = (data.documents || []).map((doc, i) => {
      let detail = "";
      if (data.algo === "bm25") {
        detail = `
          <div class="trace-doc-meta">length: ${doc.doc_length} tokens · source: ${escapeHtml(doc.source)}</div>
          <div class="trace-doc-terms">
            ${Object.entries(doc.term_counts || {}).slice(0, 10).map(([t, c]) => `<span class="trace-doc-term">${escapeHtml(t)}: ${c}</span>`).join("")}
          </div>
          <div class="trace-doc-scores">
            ${Object.entries(doc.term_scores || {}).map(([t, s]) => `<span class="trace-doc-score">${escapeHtml(t)}: ${s.toFixed(4)}</span>`).join("")}
          </div>
        `;
      } else if (data.algo === "tfidf") {
        detail = `
          <div class="trace-doc-meta">source: ${escapeHtml(doc.source)}</div>
          <div class="trace-vector">
            ${Object.entries(doc.vector || {}).slice(0, 8).map(([t, v]) => `<span class="trace-vector-item">${escapeHtml(t)}: ${v.toFixed(4)}</span>`).join("")}
          </div>
        `;
      } else if (data.algo === "semantic") {
        detail = `
          <div class="trace-doc-meta">cosine similarity: ${doc.cosine_similarity.toFixed(4)} · source: ${escapeHtml(doc.source)}</div>
          <div class="trace-vector">
            ${(doc.embedding_preview || []).map((v) => `<span class="trace-vector-item">${v}</span>`).join("")}
          </div>
        `;
      }
      return `
        <div class="trace-doc-card" style="animation-delay:${200 + i * 80}ms">
          <div class="trace-doc-title">${escapeHtml(doc.title)}</div>
          <div class="trace-doc-url">${escapeHtml(doc.url)}</div>
          ${detail}
          <div class="trace-doc-final">final score: ${Number(doc.score || 0).toFixed(4)}</div>
        </div>
      `;
    }).join("");

    steps += `
      <div class="trace-step" style="animation-delay:150ms">
        <div class="trace-step-header">3. Document analysis</div>
        <div class="trace-doc-grid">${docCards}</div>
      </div>
    `;

    // Step 4: Final ranking chart
    steps += `
      <div class="trace-step" style="animation-delay:300ms">
        <div class="trace-step-header">4. Final ranking</div>
        <div class="trace-chart-wrap">
          <canvas id="trace-chart"></canvas>
        </div>
      </div>
    `;

    output.innerHTML = `<div class="trace-steps">${steps}</div>`;

    // Render chart
    const ctx = document.getElementById("trace-chart");
    if (ctx && data.ranked && data.ranked.length) {
      const ranked = data.ranked.slice(0, 8);
      const labels = ranked.map((r) => r.title || r.url);
      const scores = ranked.map((r) => Number(r.score || 0));
      const color = "#dc2626";
      new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: "Score", data: scores, backgroundColor: color, borderRadius: 4 }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { color: "#52525b" } },
            y: { grid: { display: false }, ticks: { color: "#52525b" } },
          },
        },
      });
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
