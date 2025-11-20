import { RandomEnv } from "./structures.js";

export interface WindProfile {
	magMin: number;
	magMax: number;
	variMin?: number;
	variMax?: number;
	gustMin?: number;
	gustMax?: number;
	weight: number;
}

export interface EnvProfile {
	todWeights: number[];
	weatherWeights: number[];
	windProfiles: WindProfile[];
}

export const weatherNames = ["Clear", "Few", "Scattered", "Broken", "Overcast", "Foggy", "Rain", "Storm"];
export const serverEnvProfile: EnvProfile = {
	todWeights: [
		// 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
		1, 1, 1, 1, 1, 3, 8, 5, 4, 3, 3, 3, 3, 3, 4, 8, 7, 3, 1, 1, 1, 1, 1, 1
	],
	weatherWeights: [
		250, // Clear
		250, // Few
		250, // Scattered,
		350, // Broken
		100, // Overcast
		100, // Foggy
		100, // Rain
		100 // Storm
	],
	windProfiles: [
		// Completely calm
		{ magMin: 0, magMax: 0, weight: 50, gustMin: 0, gustMax: 0, variMin: 0, variMax: 0 },
		// Average random wind
		{ magMin: 0, magMax: 25, weight: 100, gustMin: 0, gustMax: 5, variMin: 0, variMax: 10 },
		// Calm with gusts
		{ magMin: 0, magMax: 5, weight: 50, gustMin: 5, gustMax: 10, variMin: 0, variMax: 0 },
		// Constantly changing direction
		{ magMin: 0, magMax: 5, weight: 50, gustMin: 0, gustMax: 3, variMin: 10, variMax: 20 }
		// Hurricane :)
		// { magMin: 35, magMax: 125, weight: 5, gustMin: 15, gustMax: 45, variMin: 0, variMax: 50 }
	]
};

function logProfileWeights() {
	const todSum = serverEnvProfile.todWeights.reduce((a, b) => a + b, 0);
	const weatherSum = serverEnvProfile.weatherWeights.reduce((a, b) => a + b, 0);
	const windSum = serverEnvProfile.windProfiles.reduce((a, b) => a + b.weight, 0);

	serverEnvProfile.todWeights.forEach((w, i) => console.log(`TOD ${i + 1}: ${((w / todSum) * 100).toFixed(2)}%`));
	serverEnvProfile.weatherWeights.forEach((w, i) => console.log(`${weatherNames[i]}: ${((w / weatherSum) * 100).toFixed(2)}%`));
	serverEnvProfile.windProfiles.forEach((w, i) => console.log(`Wind ${i + 1}: ${((w.weight / windSum) * 100).toFixed(2)}%`));
}

// logProfileWeights();

function getRandomTod() {
	const sum = serverEnvProfile.todWeights.reduce((a, b) => a + b, 0);
	const select = Math.floor(Math.random() * sum);
	let count = 0;

	for (let i = 0; i < serverEnvProfile.todWeights.length; i++) {
		count += serverEnvProfile.todWeights[i];
		if (count >= select) {
			return i;
		}
	}
}

function getRandomWeather() {
	const sum = serverEnvProfile.weatherWeights.reduce((a, b) => a + b, 0);
	const select = Math.floor(Math.random() * sum);
	let count = 0;

	for (let i = 0; i < serverEnvProfile.weatherWeights.length; i++) {
		count += serverEnvProfile.weatherWeights[i];
		if (count >= select) {
			return i;
		}
	}
}

function getRandomWind() {
	const sum = serverEnvProfile.windProfiles.reduce((a, b) => a + b.weight, 0);
	const select = Math.floor(Math.random() * sum);
	let count = 0;

	for (let i = 0; i < serverEnvProfile.windProfiles.length; i++) {
		count += serverEnvProfile.windProfiles[i].weight;
		if (count >= select) {
			return i;
		}
	}
}

function rand(min: number, max: number) {
	return Math.random() * (max - min) + min;
}

export function getRandomEnv(): RandomEnv {
	const tod = getRandomTod();
	const weather = getRandomWeather();
	const wind = getRandomWind();
	const windProfile = serverEnvProfile.windProfiles[wind];

	return {
		tod,
		weather,
		wind: {
			mag: rand(windProfile.magMin, windProfile.magMax),
			vari: rand(windProfile.variMin || 0, windProfile.variMax || 0),
			gust: rand(windProfile.gustMin || 0, windProfile.gustMax || 0),
			heading: rand(0, 360)
		}
	};
}
