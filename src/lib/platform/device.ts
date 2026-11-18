// Screen wake lock and the iOS "Add to Home Screen" hint.

let lock: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
	if (!wanted || lock || document.visibilityState !== 'visible') return;
	try {
		lock = (await navigator.wakeLock?.request('screen')) ?? null;
		lock?.addEventListener('release', () => (lock = null));
	} catch {
		// low battery, unsupported, or not allowed: the screen may dim
	}
}

function onVisibility(): void {
	void acquire(); // the lock is dropped whenever the app is backgrounded
}

/** Keeps the screen on until `releaseWakeLock()`. Returns false if unsupported. */
export function keepScreenOn(): boolean {
	if (!('wakeLock' in navigator)) return false;
	wanted = true;
	document.addEventListener('visibilitychange', onVisibility);
	void acquire();
	return true;
}

export function releaseWakeLock(): void {
	wanted = false;
	document.removeEventListener('visibilitychange', onVisibility);
	void lock?.release();
	lock = null;
}

const HINT_KEY = 'trainer.installHintDismissed';

/** True on an iPhone/iPad in Safari (not yet installed) until the hint is dismissed. */
export function shouldShowInstallHint(): boolean {
	try {
		const ua = navigator.userAgent;
		const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
		const standalone =
			(navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
		return ios && !standalone && localStorage.getItem(HINT_KEY) !== '1';
	} catch {
		return false;
	}
}

export function dismissInstallHint(): void {
	try {
		localStorage.setItem(HINT_KEY, '1');
	} catch {
		// ignore
	}
}

export function vibrate(ms: number): void {
	try {
		navigator.vibrate?.(ms);
	} catch {
		// ignore
	}
}
