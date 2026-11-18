import { resolve } from '$app/paths';

type Page = '/' | '/ready' | '/run' | '/summary' | '/history';

/** Base-aware link to a page, e.g. link('/ready', { w: 'workout-a' }). */
export function link(page: Page, params?: Record<string, string>): string {
	const path = resolve(page);
	const withSlash = path.endsWith('/') ? path : `${path}/`;
	const query = params ? `?${new URLSearchParams(params)}` : '';
	return withSlash + query;
}
