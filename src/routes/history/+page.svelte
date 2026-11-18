<script lang="ts">
	import { onMount } from 'svelte';
	import { formatDuration, summarize } from '#lib/engine/stats.ts';
	import { shortDate } from '#lib/format.ts';
	import { link } from '#lib/nav.ts';
	import { exportBackup, importBackup } from '#lib/storage/backup.ts';
	import { completedSessions } from '#lib/storage/db.ts';
	import { workouts } from '#lib/workouts/index.ts';

	interface Row {
		id: string;
		date: string;
		totalMs: number;
		rpe?: number;
	}
	interface Group {
		workoutId: string;
		name: string;
		rows: Row[]; // newest first
		bestMs: number;
	}

	let groups = $state.raw<Group[]>([]);
	let loaded = $state(false);
	let message = $state('');
	let fileInput: HTMLInputElement;

	async function load() {
		const byWorkout = new Map<string, Group>();
		for (const session of await completedSessions()) {
			const totalMs = summarize(session).totalMs;
			let group = byWorkout.get(session.workoutId);
			if (!group) {
				group = { workoutId: session.workoutId, name: session.workoutName, rows: [], bestMs: totalMs };
				byWorkout.set(session.workoutId, group);
			}
			group.rows.push({ id: session.id, date: shortDate(session.startedAt), totalMs, rpe: session.rpe });
			group.bestMs = Math.min(group.bestMs, totalMs);
		}
		// Shipped workouts first, in their usual order; anything else after.
		const order = workouts.map((w) => w.config.id);
		const rank = (id: string) => (order.indexOf(id) === -1 ? order.length : order.indexOf(id));
		groups = [...byWorkout.values()].sort((a, b) => rank(a.workoutId) - rank(b.workoutId));
		loaded = true;
	}

	onMount(load);

	// Trend line: oldest → newest. The y axis is time, so a faster session sits lower.
	const W = 300;
	const H = 64;
	const PAD = 6;
	function trend(rows: Row[]): { points: string; dots: { x: number; y: number; best: boolean }[] } {
		const series = [...rows].reverse();
		const values = series.map((r) => r.totalMs);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const dots = series.map((r, i) => ({
			x: series.length === 1 ? W / 2 : PAD + (i / (series.length - 1)) * (W - 2 * PAD),
			y: max === min ? H / 2 : PAD + ((max - r.totalMs) / (max - min)) * (H - 2 * PAD),
			best: r.totalMs === min
		}));
		return { points: dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' '), dots };
	}

	async function onImport(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const { added, skipped } = await importBackup(await file.text());
			message = `Imported ${added} session${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already here` : ''}.`;
			await load();
		} catch (err) {
			message = (err as Error).message;
		}
	}
</script>

<main class="page">
	<header class="page-head">
		<a class="back" href={link('/')}>‹ Workouts</a>
		<h1>History</h1>
	</header>

	{#if loaded && groups.length === 0}
		<p class="muted">No saved sessions yet. Finish a workout and it shows up here.</p>
	{/if}

	{#each groups as group (group.workoutId)}
		{@const t = trend(group.rows)}
		<section class="card stack">
			<div class="row spread">
				<h2>{group.name}</h2>
				<span class="muted small num">best {formatDuration(group.bestMs)}</span>
			</div>

			{#if group.rows.length > 1}
				<svg
					viewBox="0 0 {W} {H}"
					role="img"
					aria-label="Total time over {group.rows.length} sessions, oldest to newest. Latest {formatDuration(
						group.rows[0].totalMs
					)}, best {formatDuration(group.bestMs)}."
				>
					<polyline points={t.points} fill="none" stroke="var(--rest)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
					{#each t.dots as dot, i (i)}
						<circle cx={dot.x} cy={dot.y} r={dot.best ? 4 : 2.5} fill={dot.best ? 'var(--accent)' : 'var(--rest)'} />
					{/each}
				</svg>
				<p class="muted small">Total time, oldest to newest — lower is faster. Green dot = best.</p>
			{/if}

			<ul class="sessions">
				{#each group.rows as row (row.id)}
					<li>
						<a href={link('/summary', { s: row.id })}>
							<span>{row.date}</span>
							<span class="muted small">{row.rpe ? `RPE ${row.rpe}` : ''}</span>
							<span class="num time">{formatDuration(row.totalMs)} ›</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<section class="card stack">
		<p class="label">Backup</p>
		<p class="muted small">
			Sessions live only on this device, and Safari can clear them. Export a copy now and then.
		</p>
		<div class="row">
			<button class="btn grow" onclick={exportBackup}>Export JSON</button>
			<button class="btn grow" onclick={() => fileInput.click()}>Import JSON</button>
		</div>
		<input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={onImport} />
		{#if message}<p role="status">{message}</p>{/if}
	</section>
</main>

<style>
	.page-head {
		justify-content: flex-start;
	}
	h2 {
		font-size: 1.1rem;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.sessions {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.sessions li + li {
		border-top: 1px solid var(--border);
	}
	.sessions a {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 12px;
		align-items: center;
		min-height: 48px;
	}
	.time {
		font-weight: 650;
	}
</style>
