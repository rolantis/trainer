/** "today", "yesterday", "3 days ago", or a short date for anything older than a week. */
export function relativeDay(iso: string, now = new Date()): string {
	const then = new Date(iso);
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	return shortDate(iso);
}

/** "Wed 18 Nov". */
export function shortDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Wed 18 Nov, 07:00". */
export function dateTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
}
