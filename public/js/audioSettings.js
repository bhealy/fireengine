// Shared audio settings management
export function loadAudioSettings() {
	try {
		const saved = localStorage.getItem('audioSettings');
		if (saved) {
			return JSON.parse(saved);
		}
	} catch (e) {
		console.warn('Failed to load audio settings:', e);
	}
	// Default settings
	return { musicVolume: 50, sfxVolume: 70 };
}

export function saveAudioSettings(settings) {
	try {
		localStorage.setItem('audioSettings', JSON.stringify(settings));
	} catch (e) {
		console.warn('Failed to save audio settings:', e);
	}
}

