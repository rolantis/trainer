import { compile, configHash, validate } from '../engine/compile';
import type { Step, WorkoutConfig } from '../engine/types';
import a from './a.json';
import b from './b.json';
import posture from './posture.json';

export interface Workout {
	config: WorkoutConfig;
	steps: Step[];
	version: string;
}

function load(raw: unknown): Workout {
	const config = raw as WorkoutConfig;
	validate(config);
	return { config, steps: compile(config), version: configHash(config) };
}

/** To add a workout: drop a JSON file in this folder and list it here. */
export const workouts: Workout[] = [a, b, posture].map(load);

export function getWorkout(id: string | null | undefined): Workout | undefined {
	return workouts.find((w) => w.config.id === id);
}
