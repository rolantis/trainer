import { expect, test, type Page } from '@playwright/test';

const TAP_GAP = 380; // just over the app's double-tap guard

const surface = (page: Page) => page.getByTestId('surface');
const tap = async (page: Page) => {
	await surface(page).click({ position: { x: 200, y: 520 } });
	await page.waitForTimeout(TAP_GAP);
};

async function startWorkout(page: Page, name: RegExp) {
	await page.goto('/');
	await page.getByRole('link', { name }).click();
	await page.getByRole('button', { name: 'Start' }).click();
	await expect(surface(page)).toHaveAttribute('data-phase', 'set');
	await page.waitForTimeout(TAP_GAP);
}

/** Taps through sets and rests until the summary screen appears. */
async function finishWorkout(page: Page) {
	for (let i = 0; i < 400; i++) {
		if (page.url().includes('/summary')) return;
		const allButton = page.getByRole('button', { name: /^All \d+$/ });
		if (await allButton.isVisible().catch(() => false)) {
			await allButton.click();
			await page.waitForTimeout(50);
		} else if (await surface(page).isVisible().catch(() => false)) {
			await tap(page).catch(() => {});
		}
	}
	throw new Error('Workout never finished');
}

test('Workout A, start to saved session', async ({ page }) => {
	await startWorkout(page, /Workout A/);

	await expect(page.getByTestId('exercise')).toHaveText('KB swings');
	await expect(page.getByTestId('target')).toHaveText('15');
	await expect(page.getByTestId('round')).toHaveText('Round 1 / 6');

	await tap(page); // set done → rest
	await expect(surface(page)).toHaveAttribute('data-phase', 'rest');
	await expect(page.getByTestId('next-name')).toHaveText('Goblet squats');

	await tap(page); // rest done → squats
	await expect(page.getByTestId('exercise')).toHaveText('Goblet squats');

	await tap(page); // → rest
	await tap(page); // → push-ups
	await tap(page); // → rest
	await tap(page); // → press, left
	await expect(page.getByTestId('exercise')).toHaveText('KB strict press · left');
	await tap(page); // left done → straight to right, no rest
	await expect(surface(page)).toHaveAttribute('data-phase', 'set');
	await expect(page.getByTestId('exercise')).toHaveText('KB strict press · right');

	await finishWorkout(page);

	await expect(page.getByTestId('total-time')).toBeVisible();
	await expect(page.getByText('First session of this workout')).toBeVisible();
	await expect(page.getByText('Round 6')).toBeVisible();
	await expect(page.getByText('Finisher')).toBeVisible();

	await page.getByRole('button', { name: '8', exact: true }).click();
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByRole('link', { name: /Workout A/ })).toContainText('Last:');
	await expect(page.getByText('Unfinished')).toHaveCount(0);

	await page.getByRole('link', { name: 'History' }).click();
	await expect(page.getByRole('heading', { name: /Workout A/ })).toBeVisible();
	await expect(page.getByText('RPE 8')).toBeVisible();
});

test('the finisher logs reps in sets until the total is reached', async ({ page }) => {
	await startWorkout(page, /Workout A/);
	// Jump to the finisher by tapping through the 6 rounds.
	for (let i = 0; i < 200; i++) {
		if ((await page.getByTestId('round').textContent()) === 'Finisher') break;
		await tap(page);
	}
	await expect(page.getByTestId('exercise')).toHaveText('KB swings');
	await expect(page.getByTestId('target')).toHaveText('50');

	await tap(page); // a plain tap must not skip a total
	await expect(page.getByTestId('target')).toHaveText('50');

	await page.getByRole('button', { name: '20', exact: true }).click();
	await expect(surface(page)).toHaveAttribute('data-phase', 'rest');
	await expect(page.getByText('30 left')).toBeVisible();
	await page.waitForTimeout(TAP_GAP);
	await tap(page);
	await expect(page.getByTestId('target')).toHaveText('30');
	await page.getByRole('button', { name: 'All 30' }).click();
	await expect(page).toHaveURL(/summary/);
});

test('long-press undoes the last tap; pause stops the workout', async ({ page }) => {
	await startWorkout(page, /Workout A/);
	await tap(page);
	await expect(surface(page)).toHaveAttribute('data-phase', 'rest');

	await surface(page).click({ position: { x: 200, y: 520 }, delay: 750 });
	await expect(surface(page)).toHaveAttribute('data-phase', 'set');
	await expect(page.getByTestId('exercise')).toHaveText('KB swings');
	await expect(page.getByText('Undone')).toBeVisible();

	await page.getByRole('button', { name: 'Pause' }).click();
	await expect(surface(page)).toHaveAttribute('data-phase', 'paused');
	await tap(page); // tap anywhere resumes, and does not also advance
	await expect(surface(page)).toHaveAttribute('data-phase', 'set');
	await expect(page.getByTestId('exercise')).toHaveText('KB swings');

	await page.keyboard.press('Space');
	await expect(surface(page)).toHaveAttribute('data-phase', 'rest');
});

test('a reload mid-workout resumes the session, paused', async ({ page }) => {
	await startWorkout(page, /Workout A/);
	await tap(page);
	await tap(page);
	await expect(page.getByTestId('exercise')).toHaveText('Goblet squats');

	await page.reload();
	await expect(surface(page)).toHaveAttribute('data-phase', 'paused');
	await tap(page);
	await expect(page.getByTestId('exercise')).toHaveText('Goblet squats');

	await page.goto('/');
	await expect(page.getByText('Unfinished')).toBeVisible();
	await page.getByRole('link', { name: 'Resume' }).click();
	await expect(surface(page)).toHaveAttribute('data-phase', 'paused');
});

test('holds count down and move on by themselves', async ({ page }) => {
	await page.clock.install();
	await page.goto('/');
	await page.getByRole('link', { name: /Posture/ }).click();
	await page.getByRole('button', { name: 'Start' }).click();

	await expect(page.getByTestId('exercise')).toHaveText('Half-kneeling hip flexor stretch · left');
	await expect(page.getByTestId('target')).toHaveText('45 s');

	await page.clock.runFor(1000);
	await surface(page).click({ position: { x: 200, y: 520 } }); // starts the countdown
	await page.clock.runFor(10_000);
	await expect(page.getByTestId('target')).toHaveText('35');

	await page.clock.runFor(36_000); // countdown ends → right side, no rest between sides
	await expect(page.getByTestId('exercise')).toHaveText('Half-kneeling hip flexor stretch · right');
	await expect(page.getByTestId('target')).toHaveText('45 s');
});

test('rest clock turns amber after the rest hint', async ({ page }) => {
	await page.clock.install();
	await page.goto('/');
	await page.getByRole('link', { name: /Workout A/ }).click();
	await page.getByRole('button', { name: 'Start' }).click();
	await page.clock.runFor(1000);
	await surface(page).click({ position: { x: 200, y: 520 } });
	await expect(surface(page)).toHaveAttribute('data-phase', 'rest');

	await page.clock.runFor(60_000);
	await expect(page.getByTestId('rest-clock')).not.toHaveClass(/over/);
	await page.clock.runFor(31_000);
	await expect(page.getByTestId('rest-clock')).toHaveClass(/over/);
	await expect(page.getByTestId('rest-clock')).toHaveText('1:31');
});

test('works offline once loaded', async ({ page, context }) => {
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('link', { name: /Workout B/ })).toBeVisible();

	await page.goto('/ready/?w=workout-b');
	await page.getByRole('button', { name: 'Start' }).click();
	await expect(page.getByTestId('exercise')).toHaveText('Goblet squats');
	await expect(page.getByTestId('target')).toHaveText('10');
	await expect(page.getByTestId('round')).toHaveText('Ladder · Rung 1 / 10');
});
