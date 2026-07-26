# Prompt Enhancer

**Live:** https://sadeghhp.github.io/prompt-enhancer/

A browser-only prompt-enhancement app. No backend — every provider call goes
straight from your browser to the LLM API, and all data (sessions, prompt
versions, providers, API keys, settings) lives in `localStorage`.

Built with Vite, TypeScript, Tailwind CSS 4, and Alpine.js.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` typechecks and emits a fully static site to `dist/` — host it
anywhere (or open via `npm run preview`).

## Usage

1. **Settings** → add a provider: name, an OpenAI-compatible base URL
   (e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`,
   `http://localhost:11434/v1` for Ollama), and an API key. Add the model IDs
   you want to use. **Test provider** verifies the endpoint/key by listing
   models; **Test** on a model runs a minimal completion against it.
2. **Enhance** page:
   - Left: session history — create, open, delete sessions.
   - Middle: advanced settings (provider, target model, output language,
     enhancement options) and the prompt textarea. Write in any language and
     pick any output language.
   - Right: enhanced versions. Each enhancement slides in as a new version;
     use ← / → to move through the full version history. Every version is
     editable — **Enhance again** re-enhances the version you're looking at
     and appends the result as a new version.

The provider must allow CORS requests from the browser (OpenAI, OpenRouter,
Groq, Mistral, and local servers all do).

> **Note:** API keys are stored only in your browser's `localStorage` and are
> sent directly from your browser to the provider you configure. Nothing is
> ever sent to, or stored on, any server operated by this project.

## Deploy

Pushing to `main` builds and publishes the static site to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

**One-time setup** (repo admin):

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not
   “Deploy from a branch”).
3. Push to `main` or re-run the **Deploy to GitHub Pages** workflow from the
   **Actions** tab.

The site is served at `https://<owner>.github.io/prompt-enhancer/`. Vite uses a
relative `base` (`./`) so assets and navigation work under that subpath.

## License

[MIT](LICENSE)
