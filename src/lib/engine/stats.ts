import { replay } from './reduce';
import type { RunState, Session, Step } from './types';

export interface RoundSplit {
	block: number;
	round: number;
	label: string;
	ms: number;
}

export interface SessionSummary {
	finished: boolean;
	totalMs: number;
	workMs: number;
	restMs: number;
	splits: RoundSplit[];
}

/** Active time of a finished workout, or time so far if `nowActive` is given. */
export function totalTime(state: RunState, nowActive?: number): number {
	if (state.finishedAt !== null) return state.finishedAt;
	if (nowActive !== undefined) return nowActive;
	return state.segments.length ? state.segments[state.segments.length - 1].end : 0;
}

function splitLabel(step: Step, multiBlock: boolean): string {
	const prefix = multiBlock && step.blockName ? `${step.blockName} · ` : '';
	if (step.blockType === 'total') return step.blockName ?? step.name;
	if (step.blockType === 'ladder') return `${prefix}${step.reps} reps`;
	if (step.roundsTotal === 1) return step.blockName ?? step.name;
	return `${prefix}Round ${step.round}`;
}

/** Time per round (work + rest), in the order the rounds were done. */
export function roundSplits(steps: Step[], state: RunState): RoundSplit[] {
	const multiBlock = new Set(steps.map((s) => s.block)).size > 1;
	const splits: RoundSplit[] = [];
	for (const seg of state.segments) {
		const step = steps[seg.step];
		let split = splits[splits.length - 1];
		if (!split || split.block !== step.block || split.round !== step.round) {
			split = { block: step.block, round: step.round, label: splitLabel(step, multiBlock), ms: 0 };
			splits.push(split);
		}
		split.ms += seg.end - seg.start;
	}
	return splits;
}

export function summarize(session: Pick<Session, 'steps' | 'events'>): SessionSummary {
	const state = replay(session.steps, session.events);
	let workMs = 0;
	let restMs = 0;
	for (const seg of state.segments) {
		if (seg.kind === 'set') workMs += seg.end - seg.start;
		else restMs += seg.end - seg.start;
	}
	return {
		finished: state.phase === 'finished',
		totalMs: totalTime(state),
		workMs,
		restMs,
		splits: roundSplits(session.steps, state)
	};
}

/** Negative = faster than last time. Null when there is nothing to compare with. */
export function deltaVsLast(totalMs: number, previousTotalMs: number | null | undefined): number | null {
	return previousTotalMs == null ? null : totalMs - previousTotalMs;
}

/** Estimated duration from history: the average of the most recent completed totals (up to 3). */
export function estimateDuration(recentTotalsMs: number[]): number | null {
	const recent = recentTotalsMs.slice(0, 3);
	if (recent.length === 0) return null;
	return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

/** 754000 → "12:34"; an hour or more → "1:02:34". */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** -42000 → "−0:42", 15000 → "+0:15". */
export function formatDelta(ms: number): string {
	return `${ms < 0 ? '−' : '+'}${formatDuration(Math.abs(ms))}`;
}
