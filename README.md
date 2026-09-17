# FitCheck v1

A single static page that tells a knitter which pattern size is closest to the
ease she wants, after accounting for the stitch gauge she actually gets.

Everything runs in the browser. There is no backend, database, account, AI, or
payment. Measurements aren't sent to our servers or analytics.

## Requirements

Node.js 22.12 or later (22.x or 24.x). The repository pins Node 22 in `.nvmrc`.

## Commands

```bash
npm ci
npm test          # Vitest: calculation, parsers, share link, analytics privacy
npm run build     # type-check, then build to dist/
npm run preview   # serve dist/ locally
```

## The calculation

All lengths are converted to cm and all gauges to stitches per 10 cm
(4 in = 10.16 cm).

```
estimated_i = finished_i × patternGauge / yourGauge
ease_i      = estimated_i − bust
diff_i      = ease_i − desiredEase
```

- **Recommendation:** the size with the smallest |diff|. Sizes within 0.05 cm of
  each other are tied; the roomier one wins and the other is mentioned.
- **Gauge difference:** d = |yours − pattern| / pattern.
    - d ≤ 5%: no message.
    - 5% < d ≤ 10%: caution.
    - d > 10%: strong warning. The estimate is still shown, together with a note
      that FitCheck only estimates width and can't vouch for neckline, shoulder,
      armhole or yoke fit.
    - A gauge ratio outside 0.5–2: "check your inputs."
- **Order:** sizes are always shown in the order entered.

The logic lives in `src/lib/fitcheck.ts`, which is pure and has no DOM access.

## Project layout

```
index.html            the single page, including the static Custom Fit teaser section
src/main.ts           form state, validation display, results, share link, analytics calls
src/styles.css        mobile-first styles
src/lib/              pure logic (calculation, units, parsers, formatting, share state, analytics)
src/ui/results.ts     result sheet: best match, warnings, disclosures, actions
src/ui/spectrum.ts    fit spectrum: sizes by ease on the body, target ease marked
src/ui/dom.ts         tiny DOM helper (user text is always inserted as text)
tests/                Vitest suites
public/               favicon and Cloudflare _headers
```

## Design notes

- **Type:** Newsreader for the wordmark, headings, best-match size and hero numbers.
  Atkinson Hyperlegible Next for everything else. Both are self-hosted via Fontsource.
- **Colour:** warm neutral paper, deep ink, and one indigo accent. Light mode only in v1.
- **Result:** "See all sizes" starts open on wide screens (≥ 60rem) and collapsed on
  phones. Disclosures keep their state while results update.

## Configuration (optional)

All settings are optional. With none set, FitCheck works fully: the calculator,
share links and the Custom Fit section all work. Analytics is off, and the
waitlist button and feedback link are hidden.

For local development, copy `.env.example` to `.env`. For production, set the
values in Cloudflare Pages (see below).

> **No secrets in `VITE_` variables.** Vite copies every `VITE_` value into the
> public JavaScript bundle, where anyone can read it. Only use public URLs and
> domain names here, never API keys, tokens or passwords.

| Variable | Example | Effect when set | When unset |
| --- | --- | --- | --- |
| `VITE_WAITLIST_URL` | `https://tally.so/r/abc123` | Shows "Join the waitlist to get early access." and the "Join the Custom Fit waitlist" button. Clicks are counted as `waitlist_clicked`. | The Custom Fit section is still shown; only that line and the button are hidden. |
| `VITE_FEEDBACK_URL` | `https://tally.so/r/xyz789` | Shows "Send feedback" in the result. Clicks are counted as `feedback_clicked`. | The link is hidden. |
| `VITE_PLAUSIBLE_DOMAIN` | `fitcheck.example.com` | Loads Plausible analytics for this site domain and shows the footer note about anonymous events. | No analytics script is loaded and no events are sent. |
| `VITE_PLAUSIBLE_SRC` | *(leave unset)* | Overrides the script URL. Only needed for a proxied or self-hosted Plausible that serves the same script. | `https://plausible.io/js/script.js` is used. |

Rules for these values:

- **URLs:** they must start with `https://`, otherwise they are ignored.
- **Plausible domain:** it must match the site domain registered in Plausible exactly.
- **Plausible script:** FitCheck uses Plausible's standard `script.js` with a
  `data-domain` attribute. Plausible now also offers per-site scripts
  (`https://plausible.io/js/pa-….js`) that need a `plausible.init()` call, which
  FitCheck doesn't make. Don't paste a `pa-….js` URL into `VITE_PLAUSIBLE_SRC`.
- **Other script hosts:** if `VITE_PLAUSIBLE_SRC` points anywhere other than
  `plausible.io`, also add that host to `script-src` and `connect-src` in
  `public/_headers`, or the browser will block it.
- **Changing values:** these are build-time values, so after changing one you
  must redeploy.

### Analytics events

Analytics only ever receives these event names and category values. No typed
number or label is sent.

- `input_started`
- `example_loaded`
- `result_shown`, with these properties:
    - `units`: `cm`, `in`, or `mixed`
    - `sizes`: `1`, `2-4`, `5-8`, or `9+`
    - `gauge`: `none`, `caution`, `strong`, or `check-inputs`
    - `shift`: `0`, `1`, or `2+`
- `paste_used`
- `link_copied`
- `helpful_yes` and `helpful_no`
- `waitlist_clicked`
- `feedback_clicked`

Traffic sources come from Plausible's referrer and UTM reports. Tag community
posts with `?utm_source=…`.

Share links keep the form in the URL fragment (`#…`). Browsers never send the
fragment to a server, and Plausible ignores it by default. Don't enable
Plausible's hash-based routing option.

## Deploy: GitHub → Cloudflare Pages

FitCheck is a static site. Cloudflare Pages builds it from the GitHub repository
on every push.

### Build settings

| Setting | Value |
| --- | --- |
| Framework preset | `None` (enter the values below) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(empty, the repository root)* |
| Node.js version | 22, read from `.nvmrc`. `NODE_VERSION=22` also works. |

Build notes:

- **Install:** Pages installs dependencies from `package-lock.json` before building.
- **`NODE_ENV`:** don't set `NODE_ENV=production` as a build variable. The build
  tools are dev dependencies, and that setting would skip installing them.
- **Build system:** new Pages projects use build system v3 (Node 22 by default).
  Older projects may default to Node 18, which is too old; `.nvmrc` covers this.

### Environment variables

Set these under **Settings → Variables and Secrets** (called "Environment variables"
in older dashboards), as plain-text variables (not secrets), for the
**Production** environment:

- `VITE_WAITLIST_URL`
- `VITE_FEEDBACK_URL`
- `VITE_PLAUSIBLE_DOMAIN`

Leave `VITE_PLAUSIBLE_SRC` unset. For the **Preview** environment, consider
leaving `VITE_PLAUSIBLE_DOMAIN` unset so preview builds don't add to production
statistics.

### What the build contains

- `dist/index.html` and hashed files in `dist/assets/` (JavaScript, CSS and
  self-hosted fonts). No external fonts or CDNs are used.
- `dist/_headers` (copied from `public/_headers`), which Cloudflare Pages applies:
    - a strict Content-Security-Policy that allows only this site, plus `plausible.io` for analytics;
    - `nosniff`, a referrer policy and a permissions policy;
    - one-year immutable caching for `/assets/*`.

If you later enable Cloudflare Web Analytics or any other injected script, add
its host to the Content-Security-Policy in `public/_headers` first.

### Before each deploy

```bash
npm ci
npm run typecheck
npm test
npm run build
```
