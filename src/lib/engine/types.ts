// ---- Workout config (the JSON files in src/lib/workouts) ----

export interface Exercise {
	name: string;
	/** Rep target. Exactly one of `reps` / `holdSeconds` must be set. */
	reps?: number;
	/** Timed isometric hold, in seconds (the only countdown in the app). */
	holdSeconds?: number;
	/** Split into a left step and a right step, with no rest between them. */
	perSide?: boolean;
	/** Short hint shown under the exercise name, e.g. "hold 5 s". */
	note?: string;
}

export interface LadderExercise {
	name: string;
	perSide?: boolean;
	note?: string;
}

export type Block =
	| { type: 'rounds'; name?: string; rounds: number; exercises: Exercise[] }
	| { type: 'ladder'; name?: string; from: number; to: number; exercises: LadderExercise[] }
	| { type: 'total'; name?: string; exercise: string; target: number; note?: string };

export interface WorkoutConfig {
	id: string;
	name: string;
	/** Shown on the Ready screen; not stepped through. */
	warmup?: string[];
	/** Rest clock turns amber after this many seconds. Default 90. */
	restHintSeconds?: number;
	blocks: Block[];
}

// ---- Compiled steps ----

export type StepKind = 'reps' | 'hold' | 'total';

export interface Step {
	index: number;
	block: number;
	blockType: Block['type'];
	blockName?: string;
	/** 1-based round (or ladder rung) within the block. */
	round: number;
	roundsTotal: number;
	/** Index of the exercise within its block. */
	exercise: number;
	name: string;
	kind: StepKind;
	reps?: number;
	holdSeconds?: number;
	/** Rep total to reach, for `total` steps. */
	target?: number;
	side?: 'left' | 'right';
	note?: string;
	/** False between the left and right step of a per-side exercise, and on the final step. */
	restAfter: boolean;
}

// ---- Session events (append-only log) ----

/** `t` is milliseconds since the session's `startedAt`. */
export type SessionEvent =
	| { t: number; type: 'start' }
	| { t: number; type: 'hold_start' }
	| { t: number; type: 'done' }
	| { t: number; type: 'log_reps'; reps: number }
	| { t: number; type: 'rest_done' }
	| { t: number; type: 'pause' }
	| { t: number; type: 'resume' }
	| { t: number; type: 'undo' };

export type EventType = SessionEvent['type'];

// ---- Runner state (always derived by replaying events) ----

export type Phase = 'ready' | 'set' | 'rest' | 'finished';

/** A finished stretch of work or rest. Times are "active" ms: pauses are already removed. */
export interface Segment {
	step: number;
	kind: 'set' | 'rest';
	start: number;
	end: number;
	/** Reps performed, for set segments of rep-based steps. */
	reps?: number;
}

export interface Snapshot {
	phase: Phase;
	stepIndex: number;
	repsLogged: number;
	phaseStart: number;
	holdStart: number | null;
	segmentCount: number;
}

export interface RunState {
	phase: Phase;
	/** In `set`: the step being performed. In `rest`: the step just performed. */
	stepIndex: number;
	/** Reps logged so far on the current `total` step. */
	repsLogged: number;
	/** Active-time ms at which the current phase began. */
	phaseStart: number;
	/** Active-time ms at which the current hold's countdown began, if it has. */
	holdStart: number | null;
	/** Total ms spent in completed pauses. */
	pausedMs: number;
	/** Event time at which the current pause began, or null when running. */
	pausedAt: number | null;
	/** Active-time ms at which the workout finished. */
	finishedAt: number | null;
	segments: Segment[];
	undoStack: Snapshot[];
}

// ---- Stored session ----

export interface Session {
	id: string;
	workoutId: string;
	workoutName: string;
	/** Hash of the workout config this session was run with. */
	workoutVersion: string;
	/** The compiled steps, kept so old logs stay readable after the config changes. */
	steps: Step[];
	startedAt: string;
	events: SessionEvent[];
	completedAt?: string;
	rpe?: number;
}
