import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Session } from '../engine/types';

interface TrainerDB extends DBSchema {
	sessions: {
		key: string;
		value: Session;
		indexes: { 'by-workout': string };
	};
}

let dbPromise: Promise<IDBPDatabase<TrainerDB>> | undefined;

function db() {
	dbPromise ??= openDB<TrainerDB>('trainer', 1, {
		upgrade(database) {
			const store = database.createObjectStore('sessions', { keyPath: 'id' });
			store.createIndex('by-workout', 'workoutId');
		}
	});
	return dbPromise;
}

export async function putSession(session: Session): Promise<void> {
	await (await db()).put('sessions', session);
}

export async function getSession(id: string): Promise<Session | undefined> {
	return (await db()).get('sessions', id);
}

export async function deleteSession(id: string): Promise<void> {
	await (await db()).delete('sessions', id);
}

/** Every stored session, newest first. */
export async function allSessions(): Promise<Session[]> {
	const sessions = await (await db()).getAll('sessions');
	return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Saved (completed) sessions, newest first, optionally for one workout. */
export async function completedSessions(workoutId?: string): Promise<Session[]> {
	const sessions = workoutId
		? await (await db()).getAllFromIndex('sessions', 'by-workout', workoutId)
		: await (await db()).getAll('sessions');
	return sessions
		.filter((s) => s.completedAt)
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The session that was started but never saved, if any (newest one wins). */
export async function unfinishedSession(): Promise<Session | undefined> {
	return (await allSessions()).find((s) => !s.completedAt);
}

/** Asks the browser not to evict our data. Safari may still say no. */
export async function requestPersistence(): Promise<boolean> {
	try {
		return (await navigator.storage?.persist?.()) ?? false;
	} catch {
		return false;
	}
}
