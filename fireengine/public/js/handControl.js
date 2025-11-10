// MediaPipe Hands integration and gesture extraction
// Requires CDN scripts loaded in index.html:
// - @mediapipe/hands
// - @mediapipe/camera_utils

export async function initHandTracking(videoEl, { onGesture } = {}) {
	const hands = new window.Hands({
		locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
	});
	hands.setOptions({
		maxNumHands: 1,
		modelComplexity: 1,
		minDetectionConfidence: 0.6,
		minTrackingConfidence: 0.6
	});

	let prevCentroid = null;
	let smoothedDx = 0, smoothedDy = 0;
	let state = { isOpen: false, isFist: false };

	hands.onResults((results) => {
		const lm = results.multiHandLandmarks && results.multiHandLandmarks[0];
		if (!lm) {
			state = { isOpen: false, isFist: false };
			prevCentroid = null;
			if (onGesture) onGesture({ present: false, isOpen: false, isFist: false, dx: 0, dy: 0 });
			return;
		}

		// centroid in normalized image coords
		let cx = 0, cy = 0;
		for (const p of lm) { cx += p.x; cy += p.y; }
		cx /= lm.length; cy /= lm.length;

		// Better fist detection: compare fingertips to knuckles (base of fingers)
		// If fingertips are close to knuckles, hand is closed (fist)
		// If fingertips are far from knuckles, hand is open
		
		// Landmarks: 0=wrist, 4=thumb_tip, 8=index_tip, 12=middle_tip, 16=ring_tip, 20=pinky_tip
		//            2=thumb_knuckle, 5=index_knuckle, 9=middle_knuckle, 13=ring_knuckle, 17=pinky_knuckle
		const fingerPairs = [
			{ tip: lm[8], knuckle: lm[5], name: 'index' },    // Index finger
			{ tip: lm[12], knuckle: lm[9], name: 'middle' },  // Middle finger
			{ tip: lm[16], knuckle: lm[13], name: 'ring' },   // Ring finger
			{ tip: lm[20], knuckle: lm[17], name: 'pinky' }   // Pinky
		];
		
		// Calculate how curled each finger is (distance from tip to knuckle)
		const curlDistances = fingerPairs.map(pair => 
			Math.hypot(pair.tip.x - pair.knuckle.x, pair.tip.y - pair.knuckle.y)
		);
		
		// Average curl distance - smaller = more curled (fist), larger = extended (open)
		const avgCurl = curlDistances.reduce((a, b) => a + b, 0) / curlDistances.length;
		
		// Normalize by hand size
		const bbox = bounds(lm);
		const handSize = Math.hypot(bbox.w, bbox.h) + 1e-6;
		const curlScore = avgCurl / handSize;
		
		// Thresholds: when fingers are curled close to knuckles, curlScore is LOW
		const openCurlThresh = 0.25;  // Above this = open hand
		const fistCurlThresh = 0.15;  // Below this = fist
		
		// Detect gesture
		if (curlScore >= openCurlThresh) {
			state.isOpen = true; 
			state.isFist = false;
		} else if (curlScore <= fistCurlThresh) {
			state.isOpen = false; 
			state.isFist = true;
		} else {
			// Middle zone - keep previous state for stability
			// Don't change
		}
		
		// FIST DEBUG: Log every frame to understand the values
		console.log('FIST:', {
			curlScore: curlScore.toFixed(3),
			openCurlThresh: openCurlThresh,
			fistCurlThresh: fistCurlThresh,
			detectedState: state.isOpen ? 'OPEN' : (state.isFist ? 'FIST' : 'MIDDLE'),
			fingerCurls: curlDistances.map((d, i) => `${fingerPairs[i].name}:${d.toFixed(3)}`).join(', '),
			handSize: handSize.toFixed(3)
		});

		// motion deltas (positive dx -> move right)
		let dx = 0, dy = 0;
		if (prevCentroid) {
			dx = cx - prevCentroid.x;
			dy = cy - prevCentroid.y;
		}
		prevCentroid = { x: cx, y: cy };

		// Smooth with EMA
		const alpha = 0.3;
		smoothedDx = smoothedDx * (1 - alpha) + dx * alpha;
		smoothedDy = smoothedDy * (1 - alpha) + dy * alpha;

		if (onGesture) {
			onGesture({
				present: true,
				isOpen: state.isOpen,
				isFist: state.isFist,
				dx: smoothedDx,
				dy: smoothedDy,
				centroid: { x: cx, y: cy },
				// Absolute position for position-based controls (centered at 0.5)
				posX: cx - 0.5, // -0.5 to +0.5, where 0 is center
				posY: cy - 0.5
			});
		}
	});

	const camera = new window.Camera(videoEl, {
		onFrame: async () => {
			await hands.send({ image: videoEl });
		},
		width: 640, height: 480
	});

	// First check if camera permission is blocked
	try {
		const permissionStatus = await navigator.permissions.query({ name: 'camera' });
		console.log('Camera permission status:', permissionStatus.state);
		
		if (permissionStatus.state === 'denied') {
			throw new Error('Camera permission was previously denied. Please reset it in browser settings.');
		}
	} catch (err) {
		console.warn('Could not query camera permission:', err);
		// Continue anyway - some browsers don't support permissions API
	}

	// Wrap camera.start() to catch permission errors
	return new Promise((resolve, reject) => {
		let startTimeout = setTimeout(() => {
			reject(new Error('Camera initialization timed out after 10 seconds. Permission may be blocked.'));
		}, 10000);

		const originalStart = camera.start.bind(camera);
		camera.start = function() {
			try {
				const result = originalStart();
				// Camera.start() returns a promise in some versions
				if (result && result.catch) {
					result.then(() => {
						clearTimeout(startTimeout);
						resolve({ hands, camera });
					}).catch((err) => {
						clearTimeout(startTimeout);
						reject(err);
					});
				} else {
					// If no promise, assume success after a short delay
					setTimeout(() => {
						clearTimeout(startTimeout);
						resolve({ hands, camera });
					}, 1000);
				}
			} catch (err) {
				clearTimeout(startTimeout);
				reject(err);
			}
		};
		camera.start();
	});
}

function bounds(points) {
	let minX = 1, minY = 1, maxX = 0, maxY = 0;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}


