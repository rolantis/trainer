// Voice cues (Web Speech) and beeps (Web Audio). On iOS both only work after a
// user gesture, so `unlockSound()` must be called from the Start tap.

const MUTE_KEY = 'trainer.muted';

let audio: AudioContext | undefined;

export function isMuted(): boolean {
	try {
		return localStorage.getItem(MUTE_KEY) === '1';
	} catch {
		return false;
	}
}

export function setMuted(muted: boolean): void {
	try {
		localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
	} catch {
		// private mode: the setting just won't stick
	}
	if (muted) globalThis.speechSynthesis?.cancel();
}

export function unlockSound(): void {
	try {
		const Ctx = globalThis.AudioContext ?? (globalThis as any).webkitAudioContext;
		if (Ctx) {
			audio ??= new Ctx();
			void audio!.resume();
		}
		if (globalThis.speechSynthesis) {
			const warmup = new SpeechSynthesisUtterance(' ');
			warmup.volume = 0;
			speechSynthesis.speak(warmup);
		}
	} catch {
		// sound is a nice-to-have; never block the workout on it
	}
}

export function say(text: string): void {
	if (isMuted() || !globalThis.speechSynthesis) return;
	try {
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'en-US';
		utterance.rate = 1.05;
		speechSynthesis.speak(utterance);
	} catch {
		// ignore
	}
}

export function beep(kind: 'tick' | 'go' | 'end' = 'tick'): void {
	if (isMuted() || !audio) return;
	try {
		if (audio.state === 'suspended') void audio.resume();
		const [freq, ms] = kind === 'end' ? [1320, 450] : kind === 'go' ? [880, 180] : [660, 90];
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		const t0 = audio.currentTime;
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.0001, t0);
		gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
		osc.connect(gain).connect(audio.destination);
		osc.start(t0);
		osc.stop(t0 + ms / 1000 + 0.02);
	} catch {
		// ignore
	}
}
