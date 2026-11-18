import { describe, expect, it } from 'vitest';
import { compile, configHash, validate } from '../../src/lib/engine/compile';
import type { WorkoutConfig } from '../../src/lib/engine/types';
import { getWorkout, workouts } from '../../src/lib/workouts';

const cfg = (blocks: WorkoutConfig['blocks']): WorkoutConfig => ({ id: 't', name: 'Test', blocks });

describe('compile', () => {
	it('flattens rounds into one step per exercise per round', () => {
		const steps = compile(
			cfg([
				{
					type: 'rounds',
					rounds: 2,
					exercises: [
						{ name: 'Swings', reps: 15 },
						{ name: 'Squats', reps: 10 }
					]
				}
			])
		);
		expect(steps.map((s) => [s.round, s.name, s.reps])).toEqual([
			[1, 'Swings', 15],
			[1, 'Squats', 10],
			[2, 'Swings', 15],
			[2, 'Squats', 10]
		]);
		expect(steps.every((s) => s.roundsTotal === 2 && s.kind === 'reps')).toBe(true);
		expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
	});

	it('splits per-side exercises into left and right with no rest between', () => {
		const steps = compile(
			cfg([
				{
					type: 'rounds',
					rounds: 1,
					exercises: [
						{ name: 'Press', reps: 5, perSide: true },
						{ name: 'Burpees', reps: 8 }
					]
				}
			])
		);
		expect(steps.map((s) => [s.name, s.side, s.restAfter])).toEqual([
			['Press', 'left', false],
			['Press', 'right', true],
			['Burpees', undefined, false]
		]);
	});

	it('never rests after the final step', () => {
		const steps = compile(cfg([{ type: 'total', exercise: 'Swings', target: 50 }]));
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ kind: 'total', target: 50, restAfter: false });
	});

	it('expands a descending ladder', () => {
		const steps = compile(
			cfg([{ type: 'ladder', from: 3, to: 1, exercises: [{ name: 'Squats' }, { name: 'Push-ups' }] }])
		);
		expect(steps.map((s) => [s.round, s.name, s.reps])).toEqual([
			[1, 'Squats', 3],
			[1, 'Push-ups', 3],
			[2, 'Squats', 2],
			[2, 'Push-ups', 2],
			[3, 'Squats', 1],
			[3, 'Push-ups', 1]
		]);
		expect(steps[0].roundsTotal).toBe(3);
	});

	it('expands an ascending ladder', () => {
		const steps = compile(cfg([{ type: 'ladder', from: 1, to: 3, exercises: [{ name: 'Squats' }] }]));
		expect(steps.map((s) => s.reps)).toEqual([1, 2, 3]);
	});

	it('compiles holds, including per-side holds', () => {
		const steps = compile(
			cfg([
				{
					type: 'rounds',
					rounds: 1,
					exercises: [
						{ name: 'Stretch', holdSeconds: 45, perSide: true },
						{ name: 'Plank', holdSeconds: 20 }
					]
				}
			])
		);
		expect(steps.map((s) => [s.kind, s.holdSeconds, s.side])).toEqual([
			['hold', 45, 'left'],
			['hold', 45, 'right'],
			['hold', 20, undefined]
		]);
	});
});

describe('validate', () => {
	it('rejects an exercise with both reps and a hold', () => {
		expect(() =>
			validate(cfg([{ type: 'rounds', rounds: 1, exercises: [{ name: 'X', reps: 5, holdSeconds: 5 }] }]))
		).toThrow(/exactly one/);
	});
	it('rejects an exercise with neither', () => {
		expect(() => validate(cfg([{ type: 'rounds', rounds: 1, exercises: [{ name: 'X' }] }]))).toThrow();
	});
	it('rejects unknown block types and bad numbers', () => {
		expect(() => validate(cfg([{ type: 'amrap' } as never]))).toThrow(/unknown type/);
		expect(() => validate(cfg([{ type: 'total', exercise: 'S', target: 0 }]))).toThrow();
		expect(() => validate(cfg([{ type: 'rounds', rounds: 1.5, exercises: [{ name: 'X', reps: 1 }] }]))).toThrow();
	});
});

describe('shipped workouts', () => {
	it('has A, B and posture, all valid', () => {
		expect(workouts.map((w) => w.config.id)).toEqual(['workout-a', 'workout-b', 'posture']);
	});

	it('Workout A: 6 rounds of 6 steps plus the 50-swing finisher', () => {
		const { steps } = getWorkout('workout-a')!;
		expect(steps).toHaveLength(37);
		expect(steps.slice(0, 6).map((s) => `${s.name}${s.side ? ' ' + s.side : ''} ${s.reps}`)).toEqual([
			'KB swings 15',
			'Goblet squats 10',
			'Push-ups on handles 10',
			'KB strict press left 5',
			'KB strict press right 5',
			'Step-back burpees 8'
		]);
		expect(steps[36]).toMatchObject({ kind: 'total', name: 'KB swings', target: 50 });
	});

	it('Workout B: ladder is 55 reps of each, then 5 rounds, then 100 swings', () => {
		const { steps } = getWorkout('workout-b')!;
		expect(steps).toHaveLength(51);
		const ladder = steps.filter((s) => s.blockType === 'ladder');
		const sum = (name: string) => ladder.filter((s) => s.name === name).reduce((n, s) => n + s.reps!, 0);
		expect(sum('Goblet squats')).toBe(55);
		expect(sum('Push-ups')).toBe(55);
		expect(steps[50]).toMatchObject({ kind: 'total', target: 100 });
	});

	it('Posture block: 52 steps, 3 wall sits of 45 s', () => {
		const { steps } = getWorkout('posture')!;
		expect(steps).toHaveLength(52);
		const wallSits = steps.filter((s) => s.name === 'Wall sit');
		expect(wallSits.map((s) => s.holdSeconds)).toEqual([45, 45, 45]);
	});

	it('hash is stable and changes with the config', () => {
		const a = getWorkout('workout-a')!.config;
		expect(configHash(a)).toBe(configHash(structuredClone(a)));
		expect(configHash(a)).not.toBe(configHash({ ...a, name: 'Other' }));
	});
});
