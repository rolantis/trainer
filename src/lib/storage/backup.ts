import type { Session } from '../engine/types';
import { allSessions, getSession, putSession } from './db';

export interface Backup {
	app: 'trainer';
	version: 1;
	exportedAt: string;
	sessions: Session[];
}

export async function buildBackup(): Promise<Backup> {
	return {
		app: 'trainer',
		version: 1,
		exportedAt: new Date().toISOString(),
		sessions: await allSessions()
	};
}

/** Parses and checks a backup file. Throws a readable error if it isn't one. */
export function parseBackup(text: string): Backup {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('That file is not valid JSON.');
	}
	const backup = data as Backup;
	if (backup?.app !== 'trainer' || !Array.isArray(backup.sessions)) {
		throw new Error('That file is not a trainer backup.');
	}
	for (const s of backup.sessions) {
		if (
			typeof s?.id !== 'string' ||
			typeof s.workoutId !== 'string' ||
			typeof s.startedAt !== 'string' ||
			!Array.isArray(s.events) ||
			!Array.isArray(s.steps)
		) {
			throw new Error('The backup contains a session that cannot be read.');
		}
	}
	return backup;
}

/** Adds sessions that aren't stored yet; existing ones are left untouched. */
export async function importBackup(text: string): Promise<{ added: number; skipped: number }> {
	const backup = parseBackup(text);
	let added = 0;
	let skipped = 0;
	for (const session of backup.sessions) {
		if (await getSession(session.id)) {
			skipped++;
		} else {
			await putSession(session);
			added++;
		}
	}
	return { added, skipped };
}

/** Hands the backup to the share sheet where possible (iOS), otherwise downloads it. */
export async function exportBackup(): Promise<void> {
	const backup = await buildBackup();
	const name = `trainer-backup-${backup.exportedAt.slice(0, 10)}.json`;
	const file = new File([JSON.stringify(backup, null, 2)], name, { type: 'application/json' });

	if (navigator.canShare?.({ files: [file] })) {
		try {
			await navigator.share({ files: [file], title: name });
			return;
		} catch (err) {
			if ((err as Error).name === 'AbortError') return;
		}
	}

	const url = URL.createObjectURL(file);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
