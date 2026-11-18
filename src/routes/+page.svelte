<script lang="ts">
	import { onMount } from 'svelte';
	import { summarize, formatDuration } from '#lib/engine/stats.ts';
	import type { Session } from '#lib/engine/types.ts';
	import { relativeDay } from '#lib/format.ts';
	import { link } from '#lib/nav.ts';
	import { dismissInstallHint, shouldShowInstallHint } from '#lib/platform/device.ts';
	import { runner } from '#lib/runner/session.svelte.ts';
	import { completedSessions, deleteSession, unfinishedSession } from '#lib/storage/db.ts';
	import { workouts } from '#lib/workouts/index.ts';

	let last = $state<Record<string, { when: string; total: string }>>({});
	let unfinished = $state.raw<Session | null>(null);
	let installHint = $state(false);

	onMount(async () => {
		installHint = shouldShowInstallHint();
		await runner.flushed();
		unfinished = (await unfinishedSession()) ?? null;

		const latest: typeof last = {};
		for (const session of await completedSessions()) {
			latest[session.workoutId] ??= {
				when: relativeDay(session.completedAt!),
				total: formatDuration(summarize(session).totalMs)
			};
		}
		last = latest;
	});

	async function discardUnfinished() {
		if (!unfinished || !confirm('Discard the unfinished session? Its times will be lost.')) return;
		if (runner.session?.id === unfinished.id) runner.clear();
		await deleteSession(unfinished.id);
		unfinished = null;
	}

	function hideHint() {
		dismissInstallHint();
		installHint = false;
	}
</script>

<main class="page">
	<header class="page-head">
		<h1>Trainer</h1>
		<a class="btn ghost" href={link('/history')}>History</a>
	</header>

	{#if unfinished}
		<section class="card stack" aria-label="Unfinished session">
			<div>
				<p class="label">Unfinished</p>
				<p>{unfinished.workoutName}</p>
			</div>
			<div class="row">
				<a class="btn primary grow" href={link('/run')}>Resume</a>
				<button class="btn danger" onclick={discardUnfinished}>Discard</button>
			</div>
		</section>
	{/if}

	<ul class="workouts">
		{#each workouts as workout (workout.config.id)}
			{@const done = last[workout.config.id]}
			<li>
				<a class="card workout" href={link('/ready', { w: workout.config.id })}>
					<span class="name">{workout.config.name}</span>
					<span class="muted small num">
						{#if done}Last: {done.total} · {done.when}{:else}Not done yet{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>

	{#if installHint}
		<aside class="card stack">
			<p>
				<strong>Install on your iPhone:</strong> tap <em>Share</em>, then
				<em>Add to Home Screen</em>. It then opens full screen and works offline.
			</p>
			<button class="btn" onclick={hideHint}>Got it</button>
		</aside>
	{/if}
</main>

<style>
	.workouts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.workout {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 20px 16px;
	}
	.workout:active {
		background: var(--surface-2);
	}
	.name {
		font-size: 1.2rem;
		font-weight: 650;
	}
</style>
