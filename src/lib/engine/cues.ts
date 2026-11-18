import type { Step } from './types';

/** "KB swings" → "kettlebell swings", so the voice doesn't spell out letters. */
function spoken(name: string): string {
	return name.replace(/\bKB\b/g, 'kettlebell').replace(/\bRDL\b/g, 'Romanian deadlift');
}

function amount(step: Step, repsLeft?: number): string {
	if (step.kind === 'hold') return `${step.holdSeconds} seconds`;
	if (step.kind === 'total') {
		return repsLeft !== undefined && repsLeft < (step.target ?? 0)
			? `${repsLeft} left`
			: `${step.target} total`;
	}
	return String(step.reps);
}

/** What to say when a set begins: "Goblet squats, 10". */
export function setCue(step: Step, repsLeft?: number): string {
	if (step.side === 'right') return `Right side, ${amount(step, repsLeft)}`;
	const side = step.side ? `, ${step.side} side` : '';
	return `${spoken(step.name)}${side}, ${amount(step, repsLeft)}`;
}

/** What to say when a rest begins: "Rest. Next: push-ups, 10". */
export function restCue(next: Step | null, repsLeft?: number): string {
	if (!next) return 'Rest.';
	const side = next.side ? `, ${next.side} side` : '';
	return `Rest. Next: ${spoken(next.name)}${side}, ${amount(next, repsLeft)}`;
}

/** The on-screen target: "15", "5 left", "45 s", "50 total". */
export function targetLabel(step: Step, repsLeft?: number): string {
	if (step.kind === 'hold') return `${step.holdSeconds} s`;
	if (step.kind === 'total') {
		return repsLeft !== undefined && repsLeft < (step.target ?? 0)
			? `${repsLeft} left`
			: `${step.target} total`;
	}
	return String(step.reps);
}

/** "KB strict press · left". */
export function stepTitle(step: Step): string {
	return step.side ? `${step.name} · ${step.side}` : step.name;
}
