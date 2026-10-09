// Assembles the single-file app from src/. Usage: node build.js
//   dist/artifact.html : page body only (the Artifact publisher wraps it in a document)
//   dist/index.html    : standalone document for any static host (GitHub Pages, Netlify, Vercel)
// urls.json holds the public address of each build, so share links point at a page other people can open.
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const urls = JSON.parse(fs.readFileSync(path.join(__dirname, 'urls.json'), 'utf8'));
const title = 'Loop500';
const description = 'A referral engine and live tracker for one job: 500 final-year registrations in 7 days on ₹2,000. Prototype by Priyanshu Kumar Jha for the NxtWave Growth Challenge.';
const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">';
const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230e1622'/%3E%3Cpath d='M7 22l6-7 4 4 8-10' fill='none' stroke='%236da7ec' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

function page(canonical, embedded) {
  let app = src('app.js').replace("'__CANONICAL_URL__'", JSON.stringify(canonical || '__CANONICAL_URL__'));
  if (embedded) app = app.replace(/\/\*DL-START\*\/[\s\S]*?\/\*DL-END\*\//, "copyText(text, 'CSV copied');").replace('var CAN_SAVE_FILES = true;', 'var CAN_SAVE_FILES = false;');
  return `${fonts}\n<style>\n${src('styles.css')}</style>\n${src('body.html')}<script>\n${src('core.js')}</script>\n<script>\n${app}</script>\n`;
}

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), `<title>${title}</title>\n${page(urls.artifactUrl, true)}`);
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}: referral engine and live tracker">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta name="robots" content="noindex">
<link rel="icon" href="${icon}">
</head>
<body>
${page(urls.siteUrl, false)}</body>
</html>
`);
for (const f of ['artifact.html', 'index.html']) console.log(f, (fs.statSync(path.join(__dirname, 'dist', f)).size / 1024).toFixed(1) + ' KB');
