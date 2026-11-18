import { describe, expect, it } from 'vitest';
import { compile } from '../../src/lib/engine/compile';
import { restCue, setCue, stepTitle, targetLabel } from '../../src/lib/engine/cues';
import { parseBackup } from '../../src/lib/storage/backup';

const steps = compile({
	id: 't',
	name: 'T',
	blocks: [
		{
			type: 'rounds',
			rounds: 1,
			exercises: [
				{ name: 'Goblet squats', reps: 10 },
				{ name: 'KB strict press', reps: 5, perSide: true },
				{ name: 'Wall sit', holdSeconds: 45 }
			]
		},
		{ type: 'total', exercise: 'KB swings', target: 50 }
	]
});
const [squats, pressLeft, pressRight, wallSit, swings] = steps;

describe('voice cues', () => {
	it('announces the exercise and target', () => {
		expect(setCue(squats)).toBe('Goblet squats, 10');
		expect(setCue(wallSit)).toBe('Wall sit, 45 seconds');
	});
	it('says "kettlebell" instead of spelling KB, and names the side', () => {
		expect(setCue(pressLeft)).toBe('kettlebell strict press, left side, 5');
		expect(setCue(pressRight)).toBe('Right side, 5');
	});
	it('announces totals and what is left', () => {
		expect(setCue(swings)).toBe('kettlebell swings, 50 total');
		expect(setCue(swings, 30)).toBe('kettlebell swings, 30 left');
	});
	it('announces what comes after the rest', () => {
		expect(restCue(squats)).toBe('Rest. Next: Goblet squats, 10');
		expect(restCue(swings, 20)).toBe('Rest. Next: kettlebell swings, 20 left');
		expect(restCue(null)).toBe('Rest.');
	});
	it('labels steps on screen', () => {
		expect(stepTitle(pressLeft)).toBe('KB strict press · left');
		expect(targetLabel(wallSit)).toBe('45 s');
		expect(targetLabel(swings, 30)).toBe('30 left');
	});
});

describe('backup files', () => {
	it('accepts a valid backup', () => {
		const text = JSON.stringify({
			app: 'trainer',
			version: 1,
			exportedAt: '2026-11-18T00:00:00Z',
			sessions: [{ id: 'a', workoutId: 'workout-a', startedAt: '2026-11-18T07:00:00Z', events: [], steps: [] }]
		});
		expect(parseBackup(text).sessions).toHaveLength(1);
	});
	it('rejects other files with a readable message', () => {
		expect(() => parseBackup('nope')).toThrow(/not valid JSON/);
		expect(() => parseBackup('{"sessions":[]}')).toThrow(/not a trainer backup/);
		expect(() => parseBackup('{"app":"trainer","sessions":[{"id":1}]}')).toThrow(/cannot be read/);
	});
});
