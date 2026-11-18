// Renders static/icon.svg into the PNG icons the manifest and iOS need.
// Run with: node scripts/make-icons.mjs  (uses Playwright's Chromium)
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../static/icon.svg', import.meta.url), 'utf8');
const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// `inset` shrinks the artwork for maskable/iOS icons, which get cropped to a shape.
const icons = [
	{ file: 'icon-192.png', size: 192, inset: 0, transparent: true },
	{ file: 'icon-512.png', size: 512, inset: 0, transparent: true },
	{ file: 'icon-maskable-512.png', size: 512, inset: 0.1, transparent: false },
	{ file: 'apple-touch-icon.png', size: 180, inset: 0.06, transparent: false }
];

const browser = await chromium.launch();
for (const { file, size, inset, transparent } of icons) {
	const page = await browser.newPage({ viewport: { width: size, height: size } });
	const scale = 1 - inset * 2;
	await page.setContent(
		`<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${transparent ? 'transparent' : '#0b0f14'}">
			<img src="${data}" width="${size * scale}" height="${size * scale}"></body>`
	);
	await page.screenshot({
		path: new URL(`../static/${file}`, import.meta.url).pathname,
		omitBackground: transparent
	});
	await page.close();
}
await browser.close();
console.log(`Wrote ${icons.map((i) => i.file).join(', ')}`);
