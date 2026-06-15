# Clarus Search — Frontend

A vanilla JS, HTML, and CSS frontend for the Clarus Search engine.

## What it is

- Single-page app with hash-based routing
- Search home with source toggles, algorithm selector, and live crawl toggle
- Paginated results with source badges, scores, and highlighted snippets
- Live crawl fallback: auto-crawls sources if indexed results are sparse
- Trie-based autocomplete with keyboard navigation
- Analytics dashboard using Chart.js
- Admin panel for manual crawls

## Design

- Clean editorial light mode with generous whitespace
- Single warm accent (`#a16207`) on true white surfaces
- Outfit for headings and UI, Space Mono for URLs and metadata
- No framework, no build step

## Running locally

Requires the Clarus Search backend running on `http://localhost:8000`.

```bash
python -m http.server 3000
```

Open http://localhost:3000.

## Docker

```bash
docker build -t clarus-frontend .
docker run -p 3000:80 clarus-frontend
```

## Files

- `index.html` — page shell and font/CDN imports
- `styles.css` — full design system and component styles
- `app.js` — router, API client, and all views
- `Dockerfile` — nginx static server
