<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { stepTitle, targetLabel } from '#lib/engine/cues.ts';
	import { formatDuration } from '#lib/engine/stats.ts';
	import { link } from '#lib/nav.ts';
	import { keepScreenOn, releaseWakeLock, vibrate } from '#lib/platform/device.ts';
	import { runner } from '#lib/runner/session.svelte.ts';
	import { unfinishedSession } from '#lib/storage/db.ts';

	const LONG_PRESS_MS = 600;
	const TAP_GUARD_MS = 350; // swallows accidental double taps

	let ready = $state(false);
	let toast = $state('');
	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let longPressed = false;
	let lastAdvance = 0;

	const step = $derived(runner.step);
	const upcoming = $derived(runner.upcoming);
	const phase = $derived(runner.state.phase);
	const isTotal = $derived(step?.kind === 'total');
	const roundLabel = $derived.by(() => {
		if (!step) return '';
		const block = step.blockName ? `${step.blockName} · ` : '';
		if (step.blockType === 'total') return step.blockName ?? 'Total';
		if (step.roundsTotal === 1) return step.blockName ?? '';
		return `${block}${step.blockType === 'ladder' ? 'Rung' : 'Round'} ${step.round} / ${step.roundsTotal}`;
	});
	const holdLeft = $derived(runner.holdLeftMs);
	const restOver = $derived(phase === 'rest' && runner.phaseMs >= runner.restHintMs);
	const progress = $derived(
		runner.steps.length
			? (runner.state.stepIndex + (phase === 'rest' ? 1 : 0)) / runner.steps.length
			: 0
	);
	// For a total step that still has reps left, "next" is more of the same.
	const upcomingReps = $derived(
		upcoming && upcoming.kind === 'total' && upcoming.index === step?.index ? runner.repsLeft : undefined
	);
	const repOptions = $derived.by(() => {
		const left = runner.repsLeft;
		return [...[10, 15, 20, 25].filter((n) => n < left), left];
	});

	onMount(() => {
		let stopped = false;
		(async () => {
			if (!runner.session) {
				const stored = await unfinishedSession();
				if (stopped) return;
				if (!stored) return void goto(link('/'), { replaceState: true });
				runner.load(stored);
			}
			ready = true;
		})();

		keepScreenOn();
		const timer = setInterval(() => runner.tick(), 100);
		return () => {
			stopped = true;
			clearInterval(timer);
			clearTimeout(pressTimer);
			clearTimeout(toastTimer);
			releaseWakeLock();
			// Leaving the screen mid-workout (back button, Home) pauses it, so the clocks
			// don't keep running unseen. Coming back shows "Paused — tap to resume".
			const running = runner.state.phase === 'set' || runner.state.phase === 'rest';
			if (runner.session && running && !runner.paused) runner.togglePause();
		};
	});

	$effect(() => {
		if (ready && phase === 'finished' && runner.session) {
			void goto(link('/summary', { s: runner.session.id }), { replaceState: true });
		}
	});

	function flash(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 1500);
	}

	function advance() {
		const now = performance.now();
		if (now - lastAdvance < TAP_GUARD_MS) return;
		lastAdvance = now;
		runner.advance();
	}

	function undo() {
		if (runner.undo()) {
			vibrate(30);
			flash('Undone');
		} else {
			flash('Nothing to undo');
		}
	}

	const onControl = (e: Event) => (e.target as HTMLElement).closest('[data-control]') !== null;

	function pointerDown(e: PointerEvent) {
		if (onControl(e) || runner.paused) return;
		longPressed = false;
		clearTimeout(pressTimer);
		pressTimer = setTimeout(() => {
			longPressed = true;
			undo();
		}, LONG_PRESS_MS);
	}

	function pointerUp(e: PointerEvent) {
		clearTimeout(pressTimer);
		if (onControl(e)) return;
		if (runner.paused) return runner.togglePause();
		if (!longPressed) advance();
	}

	function pointerCancel() {
		clearTimeout(pressTimer);
		longPressed = true; // a cancelled touch is never a tap
	}

	function keyDown(e: KeyboardEvent) {
		if (!ready || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
		const onButton = (e.target as HTMLElement).closest('button') !== null;
		if (e.key === ' ' || e.key === 'Enter') {
			if (onButton) return; // let the focused button do its own thing
			e.preventDefault();
			if (runner.paused) runner.togglePause();
			else advance();
		} else if (e.key === 'Backspace' || e.key === 'u') {
			e.preventDefault();
			undo();
		} else if (e.key === 'p' || e.key === 'Escape') {
			e.preventDefault();
			runner.togglePause();
		}
	}

	async function endWorkout() {
		if (!confirm('End this workout? The session will be discarded.')) return;
		await runner.discard();
		await goto(link('/'), { replaceState: true });
	}
</script>

<svelte:window onkeydown={keyDown} />

{#if ready && step && phase !== 'finished'}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="surface"
		class:rest={phase === 'rest'}
		class:paused={runner.paused}
		data-phase={runner.paused ? 'paused' : phase}
		data-testid="surface"
		onpointerdown={pointerDown}
		onpointerup={pointerUp}
		onpointercancel={pointerCancel}
		onpointerleave={pointerCancel}
		oncontextmenu={(e) => e.preventDefault()}
	>
		<header class="top">
			<button
				class="pause"
				data-control
				onclick={() => runner.togglePause()}
				aria-label={runner.paused ? 'Resume' : 'Pause'}
			>
				{runner.paused ? '▶' : '❚❚'}
			</button>
			<div class="meta">
				<span class="num">{formatDuration(runner.totalMs)}</span>
				<span class="muted" data-testid="round">{roundLabel}</span>
			</div>
		</header>

		<div class="bar" role="progressbar" aria-label="Workout progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
			<div class="fill" style:width="{progress * 100}%"></div>
		</div>

		{#if runner.paused}
			<section class="center">
				<p class="phase-label">Paused</p>
				<p class="clock num">{formatDuration(runner.totalMs)}</p>
				<p class="hint">Tap anywhere to resume</p>
				<button class="btn danger" data-control onclick={endWorkout}>End workout</button>
			</section>
		{:else if phase === 'set'}
			<section class="center" aria-live="polite">
				<h1 class="exercise" data-testid="exercise">{stepTitle(step)}</h1>

				{#if step.kind === 'hold'}
					{#if holdLeft === null}
						<p class="target num" data-testid="target">{step.holdSeconds} s</p>
						<p class="hint">Get in position, then tap to start</p>
					{:else}
						<p class="target num countdown" data-testid="target">{Math.max(0, Math.ceil(holdLeft / 1000))}</p>
						<p class="hint">Hold…</p>
					{/if}
				{:else if isTotal}
					<p class="target num" data-testid="target">{runner.repsLeft}</p>
					<p class="hint">left of {step.target} — how many did you just do?</p>
					<div class="reps" data-control>
						{#each repOptions as n (n)}
							<button class="btn rep" onclick={() => runner.logReps(n)}>
								{n === runner.repsLeft ? `All ${n}` : n}
							</button>
						{/each}
					</div>
				{:else}
					<p class="target num" data-testid="target">{step.reps}</p>
				{/if}

				{#if step.note}<p class="note">{step.note}</p>{/if}
				<p class="timer num muted">{formatDuration(runner.phaseMs)}</p>
			</section>

			<footer class="bottom">
				{#if upcoming && upcoming.index !== step.index}
					<p class="next">
						<span class="muted">{step.restAfter ? 'After rest:' : 'Then:'}</span>
						{stepTitle(upcoming)} · {targetLabel(upcoming)}
					</p>
				{:else if !upcoming}
					<p class="next muted">Last one</p>
				{/if}
				{#if holdLeft !== null}
					<p class="hint">Ends by itself · tap to end early · hold to undo</p>
				{:else if step.kind === 'reps'}
					<p class="hint">Tap anywhere when done · hold to undo</p>
				{/if}
			</footer>
		{:else}
			<section class="center" aria-live="polite">
				<p class="phase-label">Rest</p>
				<p class="clock num" class:over={restOver} data-testid="rest-clock">{formatDuration(runner.phaseMs)}</p>
				{#if upcoming}
					<div class="up-next">
						<p class="label">Next</p>
						<p class="next-name" data-testid="next-name">{stepTitle(upcoming)}</p>
						<p class="next-target num">{targetLabel(upcoming, upcomingReps)}</p>
					</div>
				{/if}
			</section>

			<footer class="bottom">
				<p class="hint">Tap anywhere to start · hold to undo</p>
			</footer>
		{/if}

		{#if toast}<p class="toast" role="status">{toast}</p>{/if}
	</div>
{/if}

<style>
	.surface {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		padding: calc(env(safe-area-inset-top) + 12px) max(20px, env(safe-area-inset-left))
			calc(env(safe-area-inset-bottom) + 20px);
		background: var(--bg);
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		touch-action: manipulation;
		cursor: pointer;
		transition: background-color 0.2s;
	}
	.surface.rest {
		background: var(--rest-bg);
	}
	.surface.paused {
		background: #17191c;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.pause {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 1rem;
		flex: none;
	}
	.meta {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}
	.meta .num {
		font-size: 1.15rem;
		font-weight: 650;
	}

	.bar {
		height: 6px;
		margin-top: 12px;
		border-radius: 3px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s;
	}
	.rest .fill {
		background: var(--rest);
	}

	.center {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		text-align: center;
		min-height: 0;
	}
	.exercise {
		font-size: clamp(2.2rem, 11vw, 4rem);
		line-height: 1.05;
		font-weight: 800;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}
	.target {
		font-size: clamp(5rem, 34vw, 11rem);
		line-height: 1;
		font-weight: 800;
		color: var(--accent);
	}
	.countdown {
		color: var(--amber);
	}
	.note {
		color: var(--muted);
		font-size: 1.1rem;
	}
	.timer {
		font-size: 1.4rem;
		margin-top: 6px;
	}

	.phase-label {
		font-size: 1.3rem;
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--rest);
	}
	.paused .phase-label {
		color: var(--muted);
	}
	.clock {
		font-size: clamp(4.5rem, 28vw, 9rem);
		line-height: 1;
		font-weight: 800;
		transition: color 0.4s;
	}
	.clock.over {
		color: var(--amber);
	}
	.up-next {
		margin-top: 18px;
		padding: 16px 22px;
		border-radius: var(--radius);
		background: rgba(255, 255, 255, 0.06);
		max-width: 100%;
	}
	.next-name {
		font-size: clamp(1.5rem, 7vw, 2.2rem);
		font-weight: 750;
		line-height: 1.15;
		text-wrap: balance;
	}
	.next-target {
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--rest);
	}

	.reps {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-top: 8px;
		cursor: default;
	}
	.rep {
		min-width: 76px;
		min-height: 64px;
		font-size: 1.35rem;
	}

	.bottom {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.next {
		font-size: 1.1rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.toast {
		position: absolute;
		left: 50%;
		bottom: calc(env(safe-area-inset-bottom) + 90px);
		transform: translateX(-50%);
		padding: 10px 18px;
		border-radius: 999px;
		background: var(--text);
		color: var(--bg);
		font-weight: 650;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.surface,
		.fill,
		.clock {
			transition: none;
		}
	}
</style>
