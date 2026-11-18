import type { RunState, SessionEvent, Snapshot, Step } from './types';

export function initialState(): RunState {
	return {
		phase: 'ready',
		stepIndex: 0,
		repsLogged: 0,
		phaseStart: 0,
		holdStart: null,
		pausedMs: 0,
		pausedAt: null,
		finishedAt: null,
		segments: [],
		undoStack: []
	};
}

/** Converts an event time to "active" time, i.e. with all pauses removed. */
export function activeAt(state: RunState, t: number): number {
	return (state.pausedAt ?? t) - state.pausedMs;
}

function snapshot(state: RunState): Snapshot {
	return {
		phase: state.phase,
		stepIndex: state.stepIndex,
		repsLogged: state.repsLogged,
		phaseStart: state.phaseStart,
		holdStart: state.holdStart,
		segmentCount: state.segments.length
	};
}

/** Closes the current set and moves on. `stepComplete` is false for a partial set of a `total` step. */
function finishSet(
	steps: Step[],
	state: RunState,
	now: number,
	reps: number | undefined,
	stepComplete: boolean
): RunState {
	const step = steps[state.stepIndex];
	const next: RunState = {
		...state,
		undoStack: [...state.undoStack, snapshot(state)],
		segments: [
			...state.segments,
			{ step: step.index, kind: 'set', start: state.phaseStart, end: now, reps }
		],
		phaseStart: now,
		holdStart: null
	};

	if (!stepComplete) return { ...next, phase: 'rest' };
	if (state.stepIndex === steps.length - 1) return { ...next, phase: 'finished', finishedAt: now };
	if (step.restAfter) return { ...next, phase: 'rest' };
	return { ...next, phase: 'set', stepIndex: state.stepIndex + 1, repsLogged: 0 };
}

/**
 * The whole runner: `(state, event) => state`. Events that make no sense in the
 * current state are ignored, so replaying any log is safe.
 */
export function reduce(steps: Step[], state: RunState, event: SessionEvent): RunState {
	if (state.pausedAt !== null) {
		if (event.type !== 'resume') return state;
		return {
			...state,
			pausedMs: state.pausedMs + Math.max(0, event.t - state.pausedAt),
			pausedAt: null
		};
	}

	const now = activeAt(state, event.t);
	const step: Step | undefined = steps[state.stepIndex];

	switch (event.type) {
		case 'start':
			if (state.phase !== 'ready' || steps.length === 0) return state;
			return { ...state, phase: 'set', stepIndex: 0, phaseStart: now };

		case 'hold_start':
			if (state.phase !== 'set' || step.kind !== 'hold' || state.holdStart !== null) return state;
			return { ...state, undoStack: [...state.undoStack, snapshot(state)], holdStart: now };

		case 'done':
			if (state.phase !== 'set' || step.kind === 'total') return state;
			return finishSet(steps, state, now, step.reps, true);

		case 'log_reps': {
			if (state.phase !== 'set' || step.kind !== 'total' || !(event.reps > 0)) return state;
			const repsLogged = state.repsLogged + event.reps;
			const complete = repsLogged >= (step.target ?? 0);
			return { ...finishSet(steps, state, now, event.reps, complete), repsLogged: complete ? 0 : repsLogged };
		}

		case 'rest_done': {
			if (state.phase !== 'rest') return state;
			const sameStep = step.kind === 'total' && state.repsLogged > 0;
			return {
				...state,
				undoStack: [...state.undoStack, snapshot(state)],
				segments: [
					...state.segments,
					{ step: step.index, kind: 'rest', start: state.phaseStart, end: now }
				],
				phase: 'set',
				stepIndex: sameStep ? state.stepIndex : state.stepIndex + 1,
				repsLogged: sameStep ? state.repsLogged : 0,
				phaseStart: now,
				holdStart: null
			};
		}

		case 'pause':
			if (state.phase !== 'set' && state.phase !== 'rest') return state;
			return { ...state, pausedAt: event.t };

		case 'resume':
			return state;

		case 'undo': {
			const last = state.undoStack[state.undoStack.length - 1];
			if (!last) return state;
			return {
				...state,
				phase: last.phase,
				stepIndex: last.stepIndex,
				repsLogged: last.repsLogged,
				phaseStart: last.phaseStart,
				holdStart: last.holdStart,
				finishedAt: null,
				segments: state.segments.slice(0, last.segmentCount),
				undoStack: state.undoStack.slice(0, -1)
			};
		}
	}
}

export function replay(steps: Step[], events: SessionEvent[]): RunState {
	return events.reduce((state, event) => reduce(steps, state, event), initialState());
}

/** The step that follows the current phase, or null if the workout ends next. */
export function upcomingStep(steps: Step[], state: RunState): Step | null {
	if (state.phase === 'ready') return steps[0] ?? null;
	if (state.phase === 'finished') return null;
	const step = steps[state.stepIndex];
	if (state.phase === 'rest' && step.kind === 'total' && state.repsLogged > 0) return step;
	return steps[state.stepIndex + 1] ?? null;
}

/** Reps still to do on a `total` step. */
export function repsRemaining(steps: Step[], state: RunState): number {
	const step = steps[state.stepIndex];
	if (!step || step.kind !== 'total') return 0;
	return Math.max(0, (step.target ?? 0) - state.repsLogged);
}

/** Ms spent in the current phase, pauses excluded. */
export function phaseElapsed(state: RunState, t: number): number {
	return Math.max(0, activeAt(state, t) - state.phaseStart);
}

/** Ms left on the running hold countdown; null if the current step isn't a started hold. */
export function holdRemaining(steps: Step[], state: RunState, t: number): number | null {
	const step = steps[state.stepIndex];
	if (state.phase !== 'set' || !step || step.kind !== 'hold' || state.holdStart === null) return null;
	return (step.holdSeconds ?? 0) * 1000 - (activeAt(state, t) - state.holdStart);
}
