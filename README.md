# Dual Crop

Crop two regions from one image at the same time. 100% client-side.

## Local dev

```bash
bun install
bun run dev
```

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. In the repo settings → **Pages**, set **Source: GitHub Actions**.
3. Push to `main` — the included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically.

`vite.config.ts` uses `base: "./"` so the build works at any path
(`username.github.io`, `username.github.io/repo-name/`, or a custom domain) with
no changes needed.