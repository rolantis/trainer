import { restCue, setCue } from '../engine/cues';
import {
	activeAt,
	holdRemaining,
	initialState,
	phaseElapsed,
	reduce,
	replay,
	repsRemaining,
	upcomingStep
} from '../engine/reduce';
import type { RunState, Session, SessionEvent, Step } from '../engine/types';
import { beep, say } from '../platform/sound';
import { deleteSession, putSession, requestPersistence } from '../storage/db';
import { getWorkout, type Workout } from '../workouts';

type Action =
	| { type: 'start' | 'hold_start' | 'done' | 'rest_done' | 'pause' | 'resume' | 'undo' }
	| { type: 'log_reps'; reps: number };

/**
 * The live session: wraps the pure reducer, appends every accepted event to the
 * log, saves the log after each one, and fires voice/beep cues.
 */
class Runner {
	session = $state.raw<Session | null>(null);
	state = $state.raw<RunState>(initialState());
	/** Current event time (ms since the session started); updated by `tick()`. */
	now = $state(0);
	restHintMs = $state(90_000);

	#startMs = 0;
	#lastCountdownBeep = 0;
	#saving: Promise<void> = Promise.resolve();

	get steps(): Step[] {
		return this.session?.steps ?? [];
	}
	get step(): Step | undefined {
		return this.steps[this.state.stepIndex];
	}
	get upcoming(): Step | null {
		return upcomingStep(this.steps, this.state);
	}
	get paused(): boolean {
		return this.state.pausedAt !== null;
	}
	get phaseMs(): number {
		return phaseElapsed(this.state, this.now);
	}
	get totalMs(): number {
		return this.state.finishedAt ?? Math.max(0, activeAt(this.state, this.now));
	}
	get holdLeftMs(): number | null {
		return holdRemaining(this.steps, this.state, this.now);
	}
	get repsLeft(): number {
		return repsRemaining(this.steps, this.state);
	}
	get canUndo(): boolean {
		return this.state.undoStack.length > 0 && !this.paused;
	}

	/** Starts a fresh session. Must be called from a user gesture (the Start tap). */
	begin(workout: Workout): void {
		this.#startMs = Date.now();
		this.session = {
			id: crypto.randomUUID(),
			workoutId: workout.config.id,
			workoutName: workout.config.name,
			workoutVersion: workout.version,
			steps: workout.steps,
			startedAt: new Date(this.#startMs).toISOString(),
			events: []
		};
		this.state = initialState();
		this.now = 0;
		this.#applyConfig(workout.config.id);
		void requestPersistence();
		this.#dispatch({ type: 'start' });
	}

	/** Picks up a stored, unsaved session (after a reload or crash). */
	load(session: Session): void {
		this.#startMs = Date.parse(session.startedAt);
		this.session = session;
		this.state = replay(session.steps, session.events);
		this.#applyConfig(session.workoutId);

		// We can't know when the app went away, so treat the gap as a pause that
		// began at the last recorded event. The user resumes with a tap.
		const last = session.events[session.events.length - 1];
		const running = this.state.phase === 'set' || this.state.phase === 'rest';
		if (running && !this.paused && last) this.#append({ t: last.t, type: 'pause' });
		this.tick();
	}

	clear(): void {
		this.session = null;
		this.state = initialState();
	}

	/** Call a few times a second while the run screen is open. */
	tick(): void {
		if (!this.session) return;
		this.now = this.#time();

		const left = this.holdLeftMs;
		if (left === null || this.paused) return;
		if (left <= 0) {
			// End the hold at the exact moment the countdown reached zero.
			this.#lastCountdownBeep = 0;
			this.#dispatch({ type: 'done' }, this.now + left);
			return;
		}
		const second = Math.ceil(left / 1000);
		if (second <= 3 && second !== this.#lastCountdownBeep) {
			this.#lastCountdownBeep = second;
			beep('tick');
		}
	}

	/** The main tap: finish the set, start the hold, or end the rest. */
	advance(): void {
		if (this.paused) return;
		const { phase, holdStart } = this.state;
		if (phase === 'rest') return this.#dispatch({ type: 'rest_done' });
		if (phase !== 'set' || !this.step) return;
		if (this.step.kind === 'total') return; // needs a rep count, see logReps
		if (this.step.kind === 'hold' && holdStart === null) return this.#dispatch({ type: 'hold_start' });
		this.#dispatch({ type: 'done' });
	}

	logReps(reps: number): void {
		this.#dispatch({ type: 'log_reps', reps });
	}

	undo(): boolean {
		if (!this.canUndo) return false;
		this.#dispatch({ type: 'undo' });
		return true;
	}

	togglePause(): void {
		this.#dispatch({ type: this.paused ? 'resume' : 'pause' });
	}

	/** Marks the finished session as complete and stores the optional RPE. */
	async save(rpe: number | null): Promise<void> {
		if (!this.session || this.state.phase !== 'finished') return;
		const last = this.session.events[this.session.events.length - 1];
		this.session = {
			...this.session,
			completedAt: new Date(this.#startMs + (last?.t ?? 0)).toISOString(),
			...(rpe ? { rpe } : {})
		};
		await this.#persist();
		this.clear();
	}

	async discard(): Promise<void> {
		const id = this.session?.id;
		this.clear();
		await this.#saving;
		if (id) await deleteSession(id);
	}

	/** Resolves once every event so far is on disk. */
	flushed(): Promise<void> {
		return this.#saving;
	}

	#applyConfig(workoutId: string): void {
		this.restHintMs = (getWorkout(workoutId)?.config.restHintSeconds ?? 90) * 1000;
	}

	#time(): number {
		const events = this.session?.events;
		const lastT = events?.length ? events[events.length - 1].t : 0;
		return Math.max(lastT, Date.now() - this.#startMs); // never run backwards
	}

	#dispatch(action: Action, at?: number): void {
		if (!this.session) return;
		const event = { ...action, t: Math.round(at ?? this.#time()) } as SessionEvent;
		const prev = this.state;
		this.#append(event);
		if (this.state !== prev) this.#cue(prev, event);
	}

	#append(event: SessionEvent): void {
		if (!this.session) return;
		const next = reduce(this.steps, this.state, event);
		if (next === this.state) return; // ignored by the engine: keep it out of the log
		this.state = next;
		this.session = { ...this.session, events: [...this.session.events, event] };
		this.now = Math.max(this.now, event.t);
		void this.#persist();
	}

	#persist(): Promise<void> {
		const snapshot = this.session;
		if (!snapshot) return this.#saving;
		this.#saving = this.#saving
			.then(() => putSession(snapshot))
			.catch((err) => console.error('Could not save session', err));
		return this.#saving;
	}

	#cue(prev: RunState, event: SessionEvent): void {
		if (event.type === 'pause' || event.type === 'resume') return;
		if (event.type === 'hold_start') return beep('go');

		const endedHold = event.type === 'done' && prev.holdStart !== null;
		if (endedHold) beep('end');

		const { phase } = this.state;
		const total = this.step?.kind === 'total' ? this.repsLeft : undefined;
		if (phase === 'finished') say('Workout complete.');
		else if (phase === 'rest') say(restCue(this.upcoming, total));
		else if (phase === 'set' && this.step) say(setCue(this.step, total));
	}
}

export const runner = new Runner();
