<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { deltaVsLast, formatDelta, formatDuration, summarize, type SessionSummary } from '#lib/engine/stats.ts';
	import type { Session } from '#lib/engine/types.ts';
	import { dateTime } from '#lib/format.ts';
	import { link } from '#lib/nav.ts';
	import { runner } from '#lib/runner/session.svelte.ts';
	import { completedSessions, deleteSession, getSession } from '#lib/storage/db.ts';

	let session = $state.raw<Session | null>(null);
	let summary = $state.raw<SessionSummary | null>(null);
	let delta = $state<number | null>(null);
	let rpe = $state<number | null>(null);
	let missing = $state(false);
	let busy = $state(false);

	const saved = $derived(Boolean(session?.completedAt));
	const longest = $derived(Math.max(1, ...(summary?.splits.map((s) => s.ms) ?? [])));

	onMount(async () => {
		const id = page.url.searchParams.get('s');
		await runner.flushed();
		const stored = id ? await getSession(id) : undefined;
		if (!stored) return void (missing = true);

		// An unsaved session belongs to the runner, so Save and Undo work after a reload too.
		if (!stored.completedAt && runner.session?.id !== stored.id) runner.load(stored);
		const result = summarize(stored);
		if (!stored.completedAt && !result.finished) return void goto(link('/run'), { replaceState: true });

		session = stored;
		summary = result;
		rpe = stored.rpe ?? null;

		const earlier = (await completedSessions(stored.workoutId)).find(
			(s) => s.id !== stored.id && s.startedAt < stored.startedAt
		);
		delta = deltaVsLast(result.totalMs, earlier ? summarize(earlier).totalMs : null);
	});

	async function save() {
		busy = true;
		await runner.save(rpe);
		await goto(link('/'), { replaceState: true });
	}

	async function backToWorkout() {
		// The last tap was a mistake: undo it and carry on.
		if (runner.undo()) await goto(link('/run'), { replaceState: true });
	}

	async function remove() {
		if (!session) return;
		const question = saved
			? 'Delete this session from your history?'
			: 'Discard this session? Its times will be lost.';
		if (!confirm(question)) return;
		busy = true;
		if (saved) await deleteSession(session.id);
		else await runner.discard();
		await goto(link(saved ? '/history' : '/'), { replaceState: true });
	}
</script>

<main class="page">
	{#if missing}
		<header class="page-head"><a class="back" href={link('/')}>‹ Workouts</a></header>
		<p>That session doesn't exist (any more).</p>
	{:else if session && summary}
		<header class="page-head">
			{#if saved}
				<a class="back" href={link('/history')}>‹ History</a>
			{:else}
				<p class="label">Workout complete</p>
			{/if}
		</header>

		<div>
			<h1>{session.workoutName}</h1>
			<p class="muted">{dateTime(session.startedAt)}</p>
		</div>

		<section class="card total">
			<p class="label">Total time</p>
			<p class="big num" data-testid="total-time">{formatDuration(summary.totalMs)}</p>
			{#if delta !== null}
				<p class="delta num" class:faster={delta < 0} class:slower={delta > 0} data-testid="delta">
					{formatDelta(delta)} vs last session
				</p>
			{:else}
				<p class="muted">First session of this workout</p>
			{/if}
			<p class="muted small num">
				Work {formatDuration(summary.workMs)} · Rest {formatDuration(summary.restMs)}
				{#if saved && session.rpe}· RPE {session.rpe}{/if}
			</p>
		</section>

		<section class="card stack">
			<p class="label">Splits</p>
			<ol class="splits">
				{#each summary.splits as split, i (i)}
					<li>
						<span class="split-label">{split.label}</span>
						<span class="split-bar"><span style:width="{(split.ms / longest) * 100}%"></span></span>
						<span class="num">{formatDuration(split.ms)}</span>
					</li>
				{/each}
			</ol>
		</section>

		{#if !saved}
			<section class="card stack">
				<p class="label">How hard was it? (optional)</p>
				<div class="rpe" role="group" aria-label="RPE, 1 to 10">
					{#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as n (n)}
						<button class="btn" class:primary={rpe === n} aria-pressed={rpe === n} onclick={() => (rpe = rpe === n ? null : n)}>
							{n}
						</button>
					{/each}
				</div>
			</section>

			<div class="grow"></div>
			<button class="btn primary big" onclick={save} disabled={busy}>Save</button>
			<div class="row spread">
				<button class="btn ghost" onclick={backToWorkout} disabled={busy}>Undo last tap</button>
				<button class="btn ghost danger" onclick={remove} disabled={busy}>Discard</button>
			</div>
		{:else}
			<div class="grow"></div>
			<button class="btn ghost danger" onclick={remove} disabled={busy}>Delete session</button>
		{/if}
	{/if}
</main>

<style>
	h1 {
		font-size: 1.5rem;
		line-height: 1.2;
	}
	.total {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.big {
		font-size: clamp(3.5rem, 20vw, 5.5rem);
		font-weight: 800;
		line-height: 1.05;
	}
	.delta {
		font-weight: 650;
	}
	.faster {
		color: var(--accent);
	}
	.slower {
		color: var(--amber);
	}
	.splits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px 12px;
		align-items: center;
	}
	.splits li {
		display: contents;
	}
	.split-bar {
		height: 8px;
		border-radius: 4px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.split-bar span {
		display: block;
		height: 100%;
		background: var(--rest);
		border-radius: 4px;
	}
	.rpe {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 8px;
	}
	.rpe .btn {
		padding: 0;
	}
</style>
