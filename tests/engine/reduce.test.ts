import { describe, expect, it } from 'vitest';
import { compile } from '../../src/lib/engine/compile';
import {
	holdRemaining,
	initialState,
	phaseElapsed,
	reduce,
	replay,
	repsRemaining,
	upcomingStep
} from '../../src/lib/engine/reduce';
import {
	deltaVsLast,
	estimateDuration,
	formatDelta,
	formatDuration,
	roundSplits,
	summarize,
	totalTime
} from '../../src/lib/engine/stats';
import type { SessionEvent, WorkoutConfig } from '../../src/lib/engine/types';
import { getWorkout } from '../../src/lib/workouts';

const cfg = (blocks: WorkoutConfig['blocks']): WorkoutConfig => ({ id: 't', name: 'Test', blocks });
const s = 1000;

// Two rounds of [Swings, Press L, Press R]
const simple = compile(
	cfg([
		{
			type: 'rounds',
			rounds: 2,
			exercises: [
				{ name: 'Swings', reps: 15 },
				{ name: 'Press', reps: 5, perSide: true }
			]
		}
	])
);

describe('reduce: sets and rests', () => {
	it('starts on the first step', () => {
		const st = replay(simple, [{ t: 0, type: 'start' }]);
		expect(st).toMatchObject({ phase: 'set', stepIndex: 0 });
	});

	it('alternates set and rest, skipping rest between sides', () => {
		const ev: SessionEvent[] = [
			{ t: 0, type: 'start' },
			{ t: 40 * s, type: 'done' } // swings done → rest
		];
		expect(replay(simple, ev)).toMatchObject({ phase: 'rest', stepIndex: 0 });

		ev.push({ t: 100 * s, type: 'rest_done' }); // → press left
		expect(replay(simple, ev)).toMatchObject({ phase: 'set', stepIndex: 1 });

		ev.push({ t: 120 * s, type: 'done' }); // → press right, no rest
		expect(replay(simple, ev)).toMatchObject({ phase: 'set', stepIndex: 2 });

		ev.push({ t: 140 * s, type: 'done' }); // → rest
		expect(replay(simple, ev)).toMatchObject({ phase: 'rest', stepIndex: 2 });
	});

	it('finishes after the last step without a rest', () => {
		const one = compile(cfg([{ type: 'rounds', rounds: 1, exercises: [{ name: 'X', reps: 1 }] }]));
		const st = replay(one, [
			{ t: 0, type: 'start' },
			{ t: 30 * s, type: 'done' }
		]);
		expect(st).toMatchObject({ phase: 'finished', finishedAt: 30 * s });
		expect(totalTime(st)).toBe(30 * s);
	});

	it('ignores events that make no sense in the current phase', () => {
		const started = replay(simple, [{ t: 0, type: 'start' }]);
		expect(reduce(simple, started, { t: 1, type: 'rest_done' })).toBe(started);
		expect(reduce(simple, started, { t: 1, type: 'start' })).toBe(started);
		expect(reduce(simple, started, { t: 1, type: 'log_reps', reps: 10 })).toBe(started);
		expect(reduce(simple, started, { t: 1, type: 'hold_start' })).toBe(started);
		expect(reduce(simple, initialState(), { t: 1, type: 'done' })).toEqual(initialState());
	});

	it('records a segment per set and rest', () => {
		const st = replay(simple, [
			{ t: 0, type: 'start' },
			{ t: 40 * s, type: 'done' },
			{ t: 100 * s, type: 'rest_done' }
		]);
		expect(st.segments).toEqual([
			{ step: 0, kind: 'set', start: 0, end: 40 * s, reps: 15 },
			{ step: 0, kind: 'rest', start: 40 * s, end: 100 * s }
		]);
	});

	it('reports the upcoming step', () => {
		const inSet = replay(simple, [{ t: 0, type: 'start' }]);
		expect(upcomingStep(simple, inSet)?.index).toBe(1);
		const lastSet = { ...inSet, stepIndex: simple.length - 1 };
		expect(upcomingStep(simple, lastSet)).toBeNull();
	});
});

describe('reduce: pause', () => {
	const ev: SessionEvent[] = [
		{ t: 0, type: 'start' },
		{ t: 10 * s, type: 'pause' },
		{ t: 70 * s, type: 'resume' },
		{ t: 90 * s, type: 'done' }
	];

	it('stops all clocks while paused', () => {
		const paused = replay(simple, ev.slice(0, 2));
		expect(paused.pausedAt).toBe(10 * s);
		expect(phaseElapsed(paused, 50 * s)).toBe(10 * s);
	});

	it('removes pause time from durations', () => {
		const st = replay(simple, ev);
		expect(st.segments[0]).toMatchObject({ start: 0, end: 30 * s });
		expect(phaseElapsed(st, 100 * s)).toBe(10 * s);
	});

	it('ignores taps and undo while paused', () => {
		const paused = replay(simple, ev.slice(0, 2));
		expect(reduce(simple, paused, { t: 20 * s, type: 'done' })).toBe(paused);
		expect(reduce(simple, paused, { t: 20 * s, type: 'undo' })).toBe(paused);
		expect(reduce(simple, paused, { t: 20 * s, type: 'pause' })).toBe(paused);
	});

	it('cannot pause before the start or after the finish', () => {
		expect(reduce(simple, initialState(), { t: 0, type: 'pause' }).pausedAt).toBeNull();
	});
});

describe('reduce: undo', () => {
	it('does nothing right after start', () => {
		const st = replay(simple, [{ t: 0, type: 'start' }]);
		expect(reduce(simple, st, { t: 5, type: 'undo' })).toBe(st);
	});

	it('undoing "done" returns to the set and keeps its clock running', () => {
		const st = replay(simple, [
			{ t: 0, type: 'start' },
			{ t: 40 * s, type: 'done' },
			{ t: 42 * s, type: 'undo' }
		]);
		expect(st).toMatchObject({ phase: 'set', stepIndex: 0 });
		expect(st.segments).toEqual([]);
		expect(phaseElapsed(st, 50 * s)).toBe(50 * s);
	});

	it('undoing "rest_done" returns to the rest and keeps its clock running', () => {
		const st = replay(simple, [
			{ t: 0, type: 'start' },
			{ t: 40 * s, type: 'done' },
			{ t: 60 * s, type: 'rest_done' },
			{ t: 61 * s, type: 'undo' }
		]);
		expect(st).toMatchObject({ phase: 'rest', stepIndex: 0 });
		expect(st.segments).toHaveLength(1);
		expect(phaseElapsed(st, 70 * s)).toBe(30 * s);
	});

	it('steps back across a per-side pair', () => {
		const st = replay(simple, [
			{ t: 0, type: 'start' },
			{ t: 40 * s, type: 'done' },
			{ t: 60 * s, type: 'rest_done' },
			{ t: 80 * s, type: 'done' }, // left done → right
			{ t: 81 * s, type: 'undo' }
		]);
		expect(st).toMatchObject({ phase: 'set', stepIndex: 1 });
	});

	it('can undo repeatedly, back to the first set', () => {
		const st = replay(simple, [
			{ t: 0, type: 'start' },
			{ t: 40 * s, type: 'done' },
			{ t: 60 * s, type: 'rest_done' },
			{ t: 61 * s, type: 'undo' },
			{ t: 62 * s, type: 'undo' },
			{ t: 63 * s, type: 'undo' }
		]);
		expect(st).toMatchObject({ phase: 'set', stepIndex: 0, segments: [], undoStack: [] });
	});

	it('can undo the finishing tap', () => {
		const one = compile(cfg([{ type: 'rounds', rounds: 1, exercises: [{ name: 'X', reps: 1 }] }]));
		const st = replay(one, [
			{ t: 0, type: 'start' },
			{ t: 30 * s, type: 'done' },
			{ t: 31 * s, type: 'undo' }
		]);
		expect(st).toMatchObject({ phase: 'set', finishedAt: null });
	});
});

describe('reduce: total blocks', () => {
	const steps = compile(
		cfg([
			{ type: 'total', exercise: 'Swings', target: 50 },
			{ type: 'rounds', rounds: 1, exercises: [{ name: 'Squats', reps: 10 }] }
		])
	);

	it('stays on the step, resting between sets, until the total is reached', () => {
		const ev: SessionEvent[] = [
			{ t: 0, type: 'start' },
			{ t: 30 * s, type: 'log_reps', reps: 25 }
		];
		let st = replay(steps, ev);
		expect(st).toMatchObject({ phase: 'rest', stepIndex: 0, repsLogged: 25 });
		expect(repsRemaining(steps, st)).toBe(25);
		expect(upcomingStep(steps, st)?.index).toBe(0);

		ev.push({ t: 60 * s, type: 'rest_done' });
		st = replay(steps, ev);
		expect(st).toMatchObject({ phase: 'set', stepIndex: 0, repsLogged: 25 });

		ev.push({ t: 90 * s, type: 'log_reps', reps: 25 });
		st = replay(steps, ev);
		expect(st).toMatchObject({ phase: 'rest', stepIndex: 0, repsLogged: 0 });
		expect(upcomingStep(steps, st)?.index).toBe(1);

		ev.push({ t: 120 * s, type: 'rest_done' });
		expect(replay(steps, ev)).toMatchObject({ phase: 'set', stepIndex: 1 });
	});

	it('logs the reps of every set', () => {
		const st = replay(steps, [
			{ t: 0, type: 'start' },
			{ t: 30 * s, type: 'log_reps', reps: 20 },
			{ t: 60 * s, type: 'rest_done' },
			{ t: 90 * s, type: 'log_reps', reps: 30 }
		]);
		expect(st.segments.filter((x) => x.kind === 'set').map((x) => x.reps)).toEqual([20, 30]);
	});

	it('"done" does not skip a total step; undo restores logged reps', () => {
		const started = replay(steps, [{ t: 0, type: 'start' }]);
		expect(reduce(steps, started, { t: 1, type: 'done' })).toBe(started);

		const st = replay(steps, [
			{ t: 0, type: 'start' },
			{ t: 30 * s, type: 'log_reps', reps: 20 },
			{ t: 60 * s, type: 'rest_done' },
			{ t: 90 * s, type: 'log_reps', reps: 30 },
			{ t: 91 * s, type: 'undo' }
		]);
		expect(st).toMatchObject({ phase: 'set', stepIndex: 0, repsLogged: 20 });
	});

	it('finishes the workout when a final total is reached', () => {
		const only = compile(cfg([{ type: 'total', exercise: 'Swings', target: 20 }]));
		const st = replay(only, [
			{ t: 0, type: 'start' },
			{ t: 30 * s, type: 'log_reps', reps: 25 }
		]);
		expect(st.phase).toBe('finished');
	});
});

describe('reduce: holds', () => {
	const steps = compile(
		cfg([
			{
				type: 'rounds',
				rounds: 1,
				exercises: [
					{ name: 'Wall sit', holdSeconds: 45 },
					{ name: 'Squats', reps: 10 }
				]
			}
		])
	);

	it('counts down only after hold_start', () => {
		const ev: SessionEvent[] = [{ t: 0, type: 'start' }];
		expect(holdRemaining(steps, replay(steps, ev), 5 * s)).toBeNull();

		ev.push({ t: 5 * s, type: 'hold_start' });
		const st = replay(steps, ev);
		expect(holdRemaining(steps, st, 5 * s)).toBe(45 * s);
		expect(holdRemaining(steps, st, 20 * s)).toBe(30 * s);
		expect(reduce(steps, st, { t: 6 * s, type: 'hold_start' })).toBe(st);
	});

	it('freezes the countdown while paused', () => {
		const st = replay(steps, [
			{ t: 0, type: 'start' },
			{ t: 5 * s, type: 'hold_start' },
			{ t: 15 * s, type: 'pause' }
		]);
		expect(holdRemaining(steps, st, 100 * s)).toBe(35 * s);
	});

	it('done ends the hold; undo goes back to the running hold, then to before it', () => {
		const ev: SessionEvent[] = [
			{ t: 0, type: 'start' },
			{ t: 5 * s, type: 'hold_start' },
			{ t: 50 * s, type: 'done' }
		];
		expect(replay(steps, ev)).toMatchObject({ phase: 'rest', holdStart: null });

		ev.push({ t: 51 * s, type: 'undo' });
		expect(replay(steps, ev)).toMatchObject({ phase: 'set', holdStart: 5 * s });

		ev.push({ t: 52 * s, type: 'undo' });
		expect(replay(steps, ev)).toMatchObject({ phase: 'set', holdStart: null });
	});

	it('is not a hold on other steps', () => {
		const st = replay(steps, [
			{ t: 0, type: 'start' },
			{ t: 5 * s, type: 'hold_start' },
			{ t: 50 * s, type: 'done' },
			{ t: 60 * s, type: 'rest_done' }
		]);
		expect(holdRemaining(steps, st, 61 * s)).toBeNull();
	});
});

describe('stats', () => {
	it('splits time per round, rest included', () => {
		const ev: SessionEvent[] = [{ t: 0, type: 'start' }];
		let t = 0;
		// round 1: swings 30 + rest 30, press L 10, press R 10 + rest 20 = 100 s
		// round 2: swings 40 + rest 30, press L 10, press R 20 = 100 s → finish
		for (const [type, dt] of [
			['done', 30],
			['rest_done', 30],
			['done', 10],
			['done', 10],
			['rest_done', 20],
			['done', 40],
			['rest_done', 30],
			['done', 10],
			['done', 20]
		] as const) {
			t += dt * s;
			ev.push({ t, type });
		}
		const st = replay(simple, ev);
		expect(st.phase).toBe('finished');
		expect(roundSplits(simple, st)).toEqual([
			{ block: 0, round: 1, label: 'Round 1', ms: 100 * s },
			{ block: 0, round: 2, label: 'Round 2', ms: 100 * s }
		]);
		const sum = summarize({ steps: simple, events: ev });
		expect(sum).toMatchObject({ finished: true, totalMs: 200 * s, workMs: 120 * s, restMs: 80 * s });
	});

	it('a full run of Workout A has 6 round splits and a finisher', () => {
		const { steps } = getWorkout('workout-a')!;
		const ev: SessionEvent[] = [{ t: 0, type: 'start' }];
		let t = 0;
		let st = replay(steps, ev);
		let guard = 0;
		while (st.phase !== 'finished' && guard++ < 500) {
			t += 10 * s;
			const step = steps[st.stepIndex];
			const event: SessionEvent =
				st.phase === 'rest'
					? { t, type: 'rest_done' }
					: step.kind === 'total'
						? { t, type: 'log_reps', reps: 25 }
						: { t, type: 'done' };
			ev.push(event);
			st = reduce(steps, st, event);
		}
		expect(st.phase).toBe('finished');
		expect(replay(steps, ev)).toEqual(st);
		const splits = roundSplits(steps, st);
		expect(splits.map((x) => x.label)).toEqual([
			'Round 1',
			'Round 2',
			'Round 3',
			'Round 4',
			'Round 5',
			'Round 6',
			'Finisher'
		]);
		expect(splits.reduce((n, x) => n + x.ms, 0)).toBe(totalTime(st));
	});

	it('compares with the last session and estimates from history', () => {
		expect(deltaVsLast(1000, 1500)).toBe(-500);
		expect(deltaVsLast(1000, null)).toBeNull();
		expect(estimateDuration([])).toBeNull();
		expect(estimateDuration([30, 60, 90, 9000])).toBe(60);
	});

	it('formats durations and deltas', () => {
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(754_000)).toBe('12:34');
		expect(formatDuration(3_754_000)).toBe('1:02:34');
		expect(formatDelta(-42_000)).toBe('−0:42');
		expect(formatDelta(15_000)).toBe('+0:15');
	});
});
