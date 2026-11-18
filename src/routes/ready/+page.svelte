<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { estimateDuration, formatDuration, summarize } from '#lib/engine/stats.ts';
	import type { Block } from '#lib/engine/types.ts';
	import { link } from '#lib/nav.ts';
	import { isMuted, setMuted, unlockSound } from '#lib/platform/sound.ts';
	import { runner } from '#lib/runner/session.svelte.ts';
	import { completedSessions, deleteSession, unfinishedSession } from '#lib/storage/db.ts';
	import { getWorkout } from '#lib/workouts/index.ts';

	const workout = $derived(getWorkout(page.url.searchParams.get('w')));

	let estimate = $state<number | null>(null);
	let sessionCount = $state(0);
	let muted = $state(false);

	onMount(async () => {
		muted = isMuted();
		if (!workout) return;
		const done = await completedSessions(workout.config.id);
		sessionCount = done.length;
		estimate = estimateDuration(done.slice(0, 3).map((s) => summarize(s).totalMs));
	});

	function describe(block: Block): { title: string; items: string[] } {
		if (block.type === 'rounds') {
			return {
				title: `${block.name ? block.name + ' — ' : ''}${block.rounds} ${block.rounds === 1 ? 'round' : 'rounds'}`,
				items: block.exercises.map((ex) => {
					const amount = ex.holdSeconds !== undefined ? `${ex.holdSeconds} s` : `${ex.reps}`;
					return `${amount}${ex.perSide ? ' per side' : ''} · ${ex.name}`;
				})
			};
		}
		if (block.type === 'ladder') {
			return {
				title: `${block.name ? block.name + ' — ' : ''}${block.from} → ${block.to}`,
				items: block.exercises.map((ex) => ex.name)
			};
		}
		return {
			title: block.name ?? 'Total',
			items: [`${block.target} ${block.exercise}${block.note ? `, ${block.note}` : ''}`]
		};
	}

	function toggleMute() {
		muted = !muted;
		setMuted(muted);
	}

	async function start() {
		if (!workout) return;
		await runner.flushed();
		const old = await unfinishedSession();
		if (old) {
			if (!confirm(`Discard the unfinished "${old.workoutName}" session and start this one?`)) return;
			runner.clear();
			await deleteSession(old.id);
		}
		unlockSound(); // must happen inside this tap for iOS
		runner.begin(workout);
		await goto(link('/run'));
	}
</script>

<main class="page">
	<header class="page-head">
		<a class="back" href={link('/')}>‹ Workouts</a>
		<button class="btn ghost" onclick={toggleMute} aria-pressed={!muted}>
			Voice: {muted ? 'off' : 'on'}
		</button>
	</header>

	{#if !workout}
		<p>That workout doesn't exist.</p>
	{:else}
		<h1>{workout.config.name}</h1>

		<p class="muted num">
			{#if estimate !== null}
				About {formatDuration(estimate)}, based on your last {Math.min(3, sessionCount)}
				{sessionCount === 1 ? 'session' : 'sessions'}
			{:else}
				No sessions yet — this one sets your baseline
			{/if}
		</p>

		{#if workout.config.warmup?.length}
			<section class="card stack">
				<p class="label">Warm-up first</p>
				<ul>
					{#each workout.config.warmup as item (item)}<li>{item}</li>{/each}
				</ul>
			</section>
		{/if}

		<section class="card stack">
			<p class="label">The workout</p>
			{#each workout.config.blocks as block, i (i)}
				{@const d = describe(block)}
				<div>
					<p class="block-title">{d.title}</p>
					<ul>
						{#each d.items as item (item)}<li>{item}</li>{/each}
					</ul>
				</div>
			{/each}
		</section>

		<div class="grow"></div>
		<div class="start">
			<button class="btn primary big" onclick={start}>Start</button>
			<p class="muted small center">Tap anywhere to advance · press and hold to undo</p>
		</div>
	{/if}
</main>

<style>
	h1 {
		font-size: 1.6rem;
		line-height: 1.2;
	}
	ul {
		margin: 0;
		padding-left: 1.1em;
		color: var(--text);
	}
	li + li {
		margin-top: 2px;
	}
	.block-title {
		font-weight: 650;
		margin-bottom: 4px;
	}
	.start {
		position: sticky;
		bottom: 0;
		margin: 0 calc(-1 * var(--pad)) calc(-1 * (env(safe-area-inset-bottom) + 24px));
		padding: 24px var(--pad) calc(env(safe-area-inset-bottom) + 16px);
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: linear-gradient(to bottom, transparent, var(--bg) 24px);
	}
	.center {
		text-align: center;
	}
</style>
