# Loop500

A referral engine and live tracker for one job: 500 final-year registrations in 7 days on ₹2,000.
Prototype for the NxtWave Growth Challenge (Round 1). Sample data is a simulated week; nothing leaves the browser.

## What is in here

| Path | What it is |
|---|---|
| `src/core.js` | The forecast model, the seeded 7-day campaign replay, and the analytics (funnel, attribution, A/B statistics, projection, daily recommendation). Pure functions, no DOM. |
| `src/app.js` | The interface: student flow, Mission control, Forecast, Launch kit. |
| `src/styles.css`, `src/body.html` | Styles and the page shell. |
| `tests/core.test.js` | Unit tests on the model and the replay. |
| `tests/explore.js`, `tests/scan.js` | Print the plan and the replay side by side, and the seed search used to pick a sample week that slips for a believable reason (captains who never post) and recovers after one decision. |
| `build.js` | Assembles everything into one file. |
| `dist/index.html` | Standalone build for any static host. |
| `dist/artifact.html` | Body-only build for the hosted page. |
| `urls.json` | The public address of each build, used for share links. |

## Run it

```bash
node --test tests/core.test.js
```

```bash
node build.js
```

Then open `dist/index.html`. No dependencies and no server are needed.

## Link format

Every sender has their own link, so every registration has an owner:

- `#c-K07-class` : Campus Captain K07, posting in a class group (`batch` and `other` also work)
- `#p-P3` : partner blast P3
- `#r-SNEH4KQ` : a student's squad code

## What a production version needs

A shared store so codes work across devices, an automation flow for confirmations and reminders, and one WhatsApp announcement group for broadcasts.
