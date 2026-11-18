/// <reference lib="webworker" />
// Offline support: precache the whole app (it is small), serve from cache first.
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `trainer-${version}`;
const scope = new URL('./', self.location.href);

// Manifest paths are relative to the base path; resolve them against our own location.
const toUrl = (path: string) => new URL(path.replace(/^\//, ''), scope).href;

// Dotfiles (e.g. .nojekyll) are skipped: hosts often don't serve them, and one failed
// request would fail the whole install.
const PRECACHE = [
	...new Set(
		[...immutable, ...assets, ...prerendered]
			.filter((entry) => !entry.path.split('/').some((part) => part.startsWith('.')))
			.map((entry) => toUrl(entry.path))
	)
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || !url.href.startsWith(scope.href)) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Pages carry their state in the query string (?w=…, ?s=…), so ignore it when matching.
			// Vary is ignored too: every file has one representation, and script requests send
			// different headers than the precache did, which would otherwise miss the cache.
			const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
			if (cached) return cached;
			try {
				return await fetch(request);
			} catch (err) {
				if (request.mode === 'navigate') {
					const home = await cache.match(scope.href, { ignoreVary: true });
					if (home) return home;
				}
				throw err;
			}
		})()
	);
});
