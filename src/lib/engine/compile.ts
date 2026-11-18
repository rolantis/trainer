import type { Block, Step, WorkoutConfig } from './types';

type Draft = Omit<Step, 'index' | 'restAfter'>;

/** Flattens a workout config into the linear list of steps the runner walks. */
export function compile(config: WorkoutConfig): Step[] {
	const drafts: Draft[] = [];
	const noRestAfter = new Set<number>();

	const push = (draft: Draft, perSide: boolean | undefined) => {
		if (perSide) {
			noRestAfter.add(drafts.length);
			drafts.push({ ...draft, side: 'left' });
			drafts.push({ ...draft, side: 'right' });
		} else {
			drafts.push(draft);
		}
	};

	config.blocks.forEach((block, b) => {
		const base = { block: b, blockType: block.type, blockName: block.name };

		if (block.type === 'rounds') {
			for (let round = 1; round <= block.rounds; round++) {
				block.exercises.forEach((ex, e) => {
					const common = {
						...base,
						round,
						roundsTotal: block.rounds,
						exercise: e,
						name: ex.name,
						note: ex.note
					};
					if (ex.holdSeconds !== undefined) {
						push({ ...common, kind: 'hold', holdSeconds: ex.holdSeconds }, ex.perSide);
					} else {
						push({ ...common, kind: 'reps', reps: ex.reps }, ex.perSide);
					}
				});
			}
		} else if (block.type === 'ladder') {
			const dir = block.to >= block.from ? 1 : -1;
			const rungs = Math.abs(block.to - block.from) + 1;
			for (let i = 0; i < rungs; i++) {
				const reps = block.from + i * dir;
				block.exercises.forEach((ex, e) => {
					push(
						{
							...base,
							round: i + 1,
							roundsTotal: rungs,
							exercise: e,
							name: ex.name,
							note: ex.note,
							kind: 'reps',
							reps
						},
						ex.perSide
					);
				});
			}
		} else {
			drafts.push({
				...base,
				round: 1,
				roundsTotal: 1,
				exercise: 0,
				name: block.exercise,
				note: block.note,
				kind: 'total',
				target: block.target
			});
		}
	});

	return drafts.map((draft, index) => ({
		...draft,
		index,
		restAfter: index < drafts.length - 1 && !noRestAfter.has(index)
	}));
}

/** Throws a readable error if a workout config is malformed. */
export function validate(config: WorkoutConfig): void {
	const fail = (msg: string): never => {
		throw new Error(`Workout "${config?.id ?? '?'}": ${msg}`);
	};
	const posInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

	if (!config.id || !config.name) fail('needs an id and a name');
	if (!Array.isArray(config.blocks) || config.blocks.length === 0) fail('needs at least one block');

	config.blocks.forEach((block: Block, b) => {
		const where = `block ${b} (${block.type})`;
		if (block.type === 'rounds') {
			if (!posInt(block.rounds)) fail(`${where}: rounds must be a positive whole number`);
			if (!block.exercises?.length) fail(`${where}: needs exercises`);
			for (const ex of block.exercises) {
				if (!ex.name) fail(`${where}: an exercise has no name`);
				const hasReps = ex.reps !== undefined;
				const hasHold = ex.holdSeconds !== undefined;
				if (hasReps === hasHold) fail(`${where}: "${ex.name}" needs exactly one of reps / holdSeconds`);
				if (!posInt(hasReps ? ex.reps : ex.holdSeconds))
					fail(`${where}: "${ex.name}" needs a positive whole number`);
			}
		} else if (block.type === 'ladder') {
			if (!posInt(block.from) || !posInt(block.to)) fail(`${where}: from/to must be positive whole numbers`);
			if (!block.exercises?.length) fail(`${where}: needs exercises`);
			for (const ex of block.exercises) if (!ex.name) fail(`${where}: an exercise has no name`);
		} else if (block.type === 'total') {
			if (!block.exercise) fail(`${where}: needs an exercise name`);
			if (!posInt(block.target)) fail(`${where}: target must be a positive whole number`);
		} else {
			fail(`block ${b}: unknown type "${(block as { type: string }).type}"`);
		}
	});
}

/** Short, stable hash of a config (FNV-1a), stored with each session. */
export function configHash(config: WorkoutConfig): string {
	const text = JSON.stringify(config);
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}
