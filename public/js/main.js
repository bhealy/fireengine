// Entry point (ES module)
import { createScene, makeFollowCamera } from "./game/scene.js";
import { generateRoads, placeHouses } from "./game/streetGenerator.js";
import { createFireEngine } from "./game/fireEngine.js";
import { createFlameManager } from "./game/flames.js";
import { initHandTracking, startHandTraining, saveHandThresholds } from "./handControl.js";
import { createFireSystem } from "./game/fireSystem.js";
import { showStar } from "./game/ui.js";
import { loadAudioSettings, saveAudioSettings } from "./audioSettings.js";

// Initialize volume controls on home screen
const musicVolumeSlider = document.getElementById('musicVolume');
const musicVolumeValue = document.getElementById('musicVolumeValue');
const sfxVolumeSlider = document.getElementById('sfxVolume');
const sfxVolumeValue = document.getElementById('sfxVolumeValue');

// Load saved settings
const audioSettings = loadAudioSettings();
musicVolumeSlider.value = audioSettings.musicVolume;
musicVolumeValue.textContent = audioSettings.musicVolume;
sfxVolumeSlider.value = audioSettings.sfxVolume;
sfxVolumeValue.textContent = audioSettings.sfxVolume;

// Update display and save when sliders change
musicVolumeSlider.addEventListener('input', (e) => {
	const value = e.target.value;
	musicVolumeValue.textContent = value;
	saveAudioSettings({ musicVolume: parseInt(value), sfxVolume: parseInt(sfxVolumeSlider.value) });
});

sfxVolumeSlider.addEventListener('input', (e) => {
	const value = e.target.value;
	sfxVolumeValue.textContent = value;
	saveAudioSettings({ musicVolume: parseInt(musicVolumeSlider.value), sfxVolume: parseInt(value) });
});

// Wait for user to click start button before requesting camera
const startBtn = document.getElementById("startGameBtn");
startBtn.addEventListener("click", startGame);
startBtn.addEventListener("mouseenter", () => {
	startBtn.style.transform = "scale(1.05)";
});
startBtn.addEventListener("mouseleave", () => {
	startBtn.style.transform = "scale(1)";
});

// Hand training button wiring
const trainBtn = document.getElementById("trainHandBtn");
if (trainBtn) {
	trainBtn.addEventListener("mouseenter", () => {
		trainBtn.style.transform = "scale(1.05)";
	});
	trainBtn.addEventListener("mouseleave", () => {
		trainBtn.style.transform = "scale(1)";
	});
	trainBtn.addEventListener("click", beginHandTraining);
}

function beginHandTraining() {
	const overlay = document.getElementById("handTrainingOverlay");
	const textEl = document.getElementById("handTrainingText");
	const countdownEl = document.getElementById("handTrainingCountdown");
	const progressEl = document.getElementById("handTrainingProgress");
	const cancelBtn = document.getElementById("handTrainingCancel");
	const video = document.getElementById("inputVideo");
	if (!overlay || !textEl || !countdownEl || !progressEl || !cancelBtn || !video) {
		console.error("Training UI elements missing");
		return;
	}
	overlay.style.display = "flex";
	trainBtn.disabled = true;
	startBtn.disabled = true;
	startBtn.textContent = "Loading...";
	let controller = null;
	const clearUI = () => {
		overlay.style.display = "none";
		trainBtn.disabled = false;
		startBtn.disabled = false;
		startBtn.textContent = "🎮 Start Game & Allow Camera";
		cancelBtn.onclick = null;
	};
	try {
		controller = startHandTraining(video, {
			onStatus: (t) => { textEl.textContent = t; },
			onCountdown: (s) => { countdownEl.textContent = String(s); },
			onProgress: (p) => { progressEl.style.width = `${Math.round(p * 100)}%`; }
		});
		cancelBtn.onclick = () => {
			if (controller) controller.cancel();
		};
		controller.promise.then((thresholds) => {
			saveHandThresholds(thresholds);
			textEl.textContent = "Training complete! Thresholds saved.";
			countdownEl.textContent = "✔";
			progressEl.style.width = "100%";
			setTimeout(() => {
				clearUI();
			}, 800);
		}).catch((err) => {
			console.warn("Training aborted:", err);
			clearUI();
		});
	} catch (e) {
		console.error("Failed to start hand training:", e);
		clearUI();
	}
}

async function startGame() {
	startBtn.disabled = true;
	startBtn.textContent = "Loading...";

	const canvas = document.getElementById("renderCanvas");
	if (!canvas) {
		console.error("Canvas not found");
		return;
	}

	try {
		const { scene } = createScene(canvas);
		
		// Procedural world
		const { roads, isPointOnAnyRoad } = generateRoads(scene, {});
		const { houses } = placeHouses(scene, roads, {});

		// Fire system
		const flames = createFlameManager(scene);
		const fire = createFireSystem(scene, houses, {
			onStart: (h) => flames.showOn(h),
			onStop: (h) => flames.hideHouse(h)
		});
		
		// Start with 200 random buildings on fire
		const normalHouses = houses.filter(h => h.state === "normal");
		const initialFireCount = Math.min(200, normalHouses.length);
		for (let i = 0; i < initialFireCount; i++) {
			const randomIdx = Math.floor(Math.random() * normalHouses.length);
			const house = normalHouses.splice(randomIdx, 1)[0]; // Remove from array to avoid duplicates
			if (house) {
				fire.startFlame(house);
			}
		}
		
		fire.igniteRandomLater();

		// Fire engine + camera follow (async load)
		const fe = await createFireEngine(scene);
		const cam = makeFollowCamera(scene, fe.root);
		scene.activeCamera = cam;
		cam.attachControl(canvas, true);

		// Water system - create engine water, drone water will be created after drone loads
		const engineWater = fire.createWater(fe.nozzle);
		let droneWater = null; // Will be created after drone loads
		let water = engineWater; // Active water system
		
		// Load saved audio settings
		const currentAudioSettings = loadAudioSettings();
		
		// Load celebration sound with user's SFX volume setting
		const celebrationSound = new Audio('./mixkit-male-crowd-cheering-short-459.wav');
		celebrationSound.volume = currentAudioSettings.sfxVolume / 100; // Convert percentage to 0-1
		
		// Load and play background music with user's music volume setting
		const backgroundMusic = new Audio('./Oh When The Saints Jazz Band 2019.mp3');
		backgroundMusic.volume = currentAudioSettings.musicVolume / 100; // Convert percentage to 0-1
		backgroundMusic.loop = true; // Loop continuously
		backgroundMusic.play().catch(err => console.warn('Background music autoplay failed:', err));

		// Load animated drone and make it follow the fire engine
		let drone = null;
		let droneTime = 0; // seconds for figure-eight motion
			try {
				await new Promise((resolve, reject) => {
					BABYLON.SceneLoader.ImportMesh(
						"",
						"./",
						"38_Aircraft.glb",
						scene,
						(meshes, _ps, _skeletons, animationGroups) => {
					// Find a sensible root for the drone
					const root = meshes.find(m => !m.parent) || meshes[0];
					if (!root) return resolve(); // nothing to do
					drone = root;
					// Scale and initial position above ground
					drone.scaling.set(1, 1, 1);
					drone.position = fe.root.position.add(new BABYLON.Vector3(0, 12, -10));
				// Ensure we can control orientation via Euler angles
				drone.rotationQuaternion = null;
				
				// Add shadow for the drone (commented out for performance)
				// const shadowGenerator = new BABYLON.ShadowGenerator(1024, scene.lights.find(l => l.name === "dir") || scene.lights[0]);
				// shadowGenerator.useBlurExponentialShadowMap = true;
				// shadowGenerator.blurKernel = 32;
				// meshes.forEach(m => {
				// 	if (m.material) {
				// 		shadowGenerator.addShadowCaster(m);
				// 	}
				// });
				// // Make ground receive shadows
				// if (scene.getMeshByName("ground")) {
				// 	scene.getMeshByName("ground").receiveShadows = true;
				// }
				
				// Start all animations if any
					if (animationGroups && animationGroups.length) {
						animationGroups.forEach(ag => ag.start(true));
					}
					// Create drone water system now that drone is loaded
					droneWater = fire.createDroneWater(drone);
					resolve();
						},
						null,
						(_scene, message, _ex) => reject(new Error(message))
					);
				});
			} catch (e) {
				console.warn("Drone load failed (38_Aircraft.glb):", e);
			}

		// Control surface (will be driven by hand gestures later)
		const control = {
			throttle: 0,     // 0..1
			steer: 0         // -1..+1
		};

		// Game HUD and mode
		const game = {
			mode: "Driving", // Driving | FlyingToFire | Extinguishing
			score: 0,
			activeHouse: null,
			holdOnTarget: 0,
			rotationProgress: 0,
			openHandTimer: 0,
			nearestBurningHouse: null,
			currentGesture: { isOpen: false, isFist: false, posX: 0, posY: 0 },
			droneTargetPos: null,
			droneAutoFlyTimer: 0,
			hasDispatchedDrone: false, // Tracks if drone has been dispatched during current stop
			cameraOrbitAngle: 0, // Angle for orbiting camera during extinguishing
			hasExceeded10MPH: false // Must reach 10 mph before drone firefighting is enabled
		};
		let aim = { yaw: 0, pitch: BABYLON.Tools.ToRadians(10) };
		const hud = {
			scoreEl: document.getElementById("score"),
			modeEl: document.getElementById("mode"),
			msgEl: document.getElementById("messages"),
			firesEl: document.getElementById("firesRemaining"),
			setScore(v) { this.scoreEl.textContent = `Score: ${v}`; },
			setMode(v) { this.modeEl.textContent = `Mode: ${v}`; },
			setFires(v) { this.firesEl.textContent = `Fires: ${v}`; },
			msg(t) { this.msgEl.textContent = t || ""; }
		};
		hud.setScore(0);
		hud.setMode("Driving");
		hud.setFires(flames.getCount());

		// Click/touch: ignite the clicked building
		function isDescendantOf(node, maybeAncestor) {
			let n = node;
			while (n) {
				if (n === maybeAncestor) return true;
				n = n.parent;
			}
			return false;
		}
		function findHouseFromMesh(mesh) {
			for (const h of houses) {
				if (mesh === h.mesh || isDescendantOf(mesh, h.mesh) || isDescendantOf(h.mesh, mesh)) {
					return h;
				}
			}
			return null;
		}
		scene.onPointerObservable.add((pi) => {
			if (pi.type !== BABYLON.PointerEventTypes.POINTERPICK) return;
			const pick = pi.pickInfo;
			if (!pick || !pick.hit || !pick.pickedMesh) return;
			const house = findHouseFromMesh(pick.pickedMesh);
			if (house && house.state !== "destroyed") {
				// Start fire on the clicked house
				fire.startFlame(house);
			}
		});

		// Fire system destroyed callback
		fire.onDestroyed((h) => {
			// Deduct points on failure
			game.score = Math.max(0, game.score - 50);
			hud.setScore(game.score);
			hud.msg("Too late—house destroyed. −50 points.");
			// Exit FF mode if this was the active target
			if (game.mode === "Firefight" && game.activeHouse && game.activeHouse.mesh.id === h.mesh.id) {
				game.mode = "Driving";
				hud.setMode("Driving");
				water.setActive(false);
				game.activeHouse = null;
				game.holdOnTarget = 0;
			}
		});

		// Debug counter for occasional logging
		let debugFrameCount = 0;
		const speedValueEl = document.getElementById("speedValue");
		const speedNeedleEl = document.getElementById("speedNeedle");
		
		// Basic tick to keep engine in place until drive-logic arrives
		scene.onBeforeRenderObservable.add(() => {
			const dt = scene.getEngine().getDeltaTime() / 1000;
			// Drive-logic: map control to motion (max speed now 50 mph)
			const maxSpeed = 50; // mph
			const minStartSpeed = 5; // mph - initial speed when starting from 0
			
			// If throttle is on and we're at zero speed, jump to minimum start speed
			if (control.throttle > 0 && fe.motion.speed === 0) {
				fe.motion.speed = minStartSpeed;
			}
			
			// Handle throttle: negative = active braking (target speed 0), positive = accelerate
			if (control.throttle < 0) {
				fe.motion.targetSpeed = 0; // Active braking - force target to 0
			} else {
				fe.motion.targetSpeed = Math.max(0, Math.min(1, control.throttle)) * maxSpeed;
			}
		fe.motion.steer = BABYLON.Scalar.Clamp(control.steer, -1, 1) * fe.motion.maxSteer;

		fe.update(dt);
		
		// Collision detection and bouncing with buildings
		const engineRadius = 3; // Approximate radius of fire engine for collision detection
		const enginePos = fe.motion.position;
		
		for (const house of houses) {
			if (house.state === "destroyed") continue; // Skip destroyed buildings
			
			const buildingPos = house.mesh.position;
			const bbox = house.mesh.getBoundingInfo().boundingBox;
			
			// Get building dimensions
			const buildingMin = bbox.minimumWorld;
			const buildingMax = bbox.maximumWorld;
			
			// Check collision with building using AABB vs circle (fire engine as circle)
			// Find closest point on building to engine
			const closestX = Math.max(buildingMin.x, Math.min(enginePos.x, buildingMax.x));
			const closestZ = Math.max(buildingMin.z, Math.min(enginePos.z, buildingMax.z));
			
			// Calculate distance from engine to closest point
			const distX = enginePos.x - closestX;
			const distZ = enginePos.z - closestZ;
			const distSq = distX * distX + distZ * distZ;
			
			// Check if collision occurred
			if (distSq < engineRadius * engineRadius) {
				// COLLISION! Calculate bounce
				const dist = Math.sqrt(distSq);
				
				// Normal vector from building to engine (bounce direction)
				let normalX = distX;
				let normalZ = distZ;
				
				// Handle edge case where engine is exactly at building center
				if (dist < 0.001) {
					// Use heading direction as fallback
					normalX = Math.sin(fe.motion.heading);
					normalZ = Math.cos(fe.motion.heading);
				} else {
					normalX /= dist;
					normalZ /= dist;
				}
				
				// Push engine out of building
				const penetration = engineRadius - dist;
				enginePos.x += normalX * penetration;
				enginePos.z += normalZ * penetration;
				fe.motion.position.copyFrom(enginePos);
				fe.root.position.copyFrom(enginePos);
				
				// Calculate bounce velocity (like a football!)
				const bounceFactor = 0.7; // Keep 70% of speed after bounce
				const currentVelX = Math.sin(fe.motion.heading) * fe.motion.speed;
				const currentVelZ = Math.cos(fe.motion.heading) * fe.motion.speed;
				
				// Reflect velocity across normal (V' = V - 2(V·N)N)
				const dotProduct = currentVelX * normalX + currentVelZ * normalZ;
				const reflectedVelX = currentVelX - 2 * dotProduct * normalX;
				const reflectedVelZ = currentVelZ - 2 * dotProduct * normalZ;
				
				// Apply bounce with damping
				fe.motion.speed *= bounceFactor;
				fe.motion.heading = Math.atan2(reflectedVelX, reflectedVelZ);
				
				// Add some visual feedback - play brake sound on collision
				// (Reusing existing brake sound system)
				break; // Only process one collision per frame
			}
		}
		
		// Update camera behavior based on mode
			if (game.mode === "FlyingToFire") {
				// Camera stays with engine while drone flies to fire
				const sideViewRotation = 0;
				cam.updateChaseCam(sideViewRotation);
			} else if (game.mode === "Extinguishing") {
				// Camera orbits around the building during extinguishing
				if (game.activeHouse && drone) {
					const buildingPos = game.activeHouse.mesh.position;
					const bbox = game.activeHouse.mesh.getBoundingInfo().boundingBox;
					const buildingHeight = bbox.maximumWorld.y - bbox.minimumWorld.y;
					
					// Orbit parameters - scale based on building size
					const orbitRadius = Math.max(35, buildingHeight * 1.5); // Further away, scales with building
					const orbitHeight = buildingHeight * 0.8; // Height relative to building
					const orbitSpeed = 0.3; // Radians per second (slow orbit)
					
					// Increment orbit angle
					game.cameraOrbitAngle += orbitSpeed * dt;
					
					// Calculate camera position on orbit
					const camX = buildingPos.x + Math.cos(game.cameraOrbitAngle) * orbitRadius;
					const camZ = buildingPos.z + Math.sin(game.cameraOrbitAngle) * orbitRadius;
					const camY = buildingPos.y + orbitHeight;
					
					const orbitPos = new BABYLON.Vector3(camX, camY, camZ);
					
					// Smoothly move camera to orbit position
					const camLerp = 1 - Math.exp(-3 * dt);
					cam.position = BABYLON.Vector3.Lerp(cam.position, orbitPos, camLerp);
					
					// Look at point between building center and drone
					const dronePos = drone.position;
					const lookAtPos = BABYLON.Vector3.Lerp(buildingPos, dronePos, 0.5);
					cam.setTarget(lookAtPos);
				}
			} else {
				// Normal follow camera for driving mode
				const sideViewRotation = 0;
				cam.updateChaseCam(sideViewRotation);
			}
			
			// Update drone - figure-eight only in driving mode when not on a mission
			if (drone && game.mode === "Driving" && fe.motion.speed > 0) {
				const enginePos = fe.motion.position;
				const heading = fe.root.rotation.y;
				// Parametric figure-eight (lemniscate-like) around the engine in local space
				droneTime += dt;
				const w = 0.5; // angular speed (rad/s) -> slow
				const a = 6;   // radius amplitude (units)
				const sx = Math.sin(w * droneTime);
				const cx = Math.cos(w * droneTime);
				// Local offsets in engine space (XZ plane)
				const xLocal = a * sx;
				const zLocal = a * sx * cx; // figure-eight pattern
				// Rotate local offset by engine heading
				const sinH = Math.sin(heading), cosH = Math.cos(heading);
				const xWorld = xLocal * cosH - zLocal * sinH;
				const zWorld = xLocal * sinH + zLocal * cosH;
				// Altitude slightly higher than before with a gentle bob
				const baseHeight = 14;
				const bob = 1.5 * Math.sin(w * droneTime * 2);
				const targetPos = new BABYLON.Vector3(
					enginePos.x + xWorld,
					enginePos.y + baseHeight + bob,
					enginePos.z + zWorld
				);
				// Store previous position to calculate direction
				const prevPos = drone.position.clone();
				// Smoothly move toward target
				const lerp = 1 - Math.exp(-4 * dt); // time-constant smoothing
				drone.position = BABYLON.Vector3.Lerp(drone.position, targetPos, lerp);
				
				// Rotate drone to face direction of travel
				const velocity = drone.position.subtract(prevPos);
				if (velocity.length() > 0.001) { // Only rotate if moving
					const targetHeading = Math.atan2(velocity.x, velocity.z);
					// Smoothly interpolate rotation
					const rotLerp = 1 - Math.exp(-5 * dt);
					drone.rotation.y = BABYLON.Scalar.Lerp(drone.rotation.y, targetHeading, rotLerp);
				}
				drone.rotation.x = 0;
				drone.rotation.z = 0;
			}
				
			// Update flames manager - create/destroy particle systems based on proximity
			flames.update(fe.motion.position);
			
			// Update fire count in HUD
			hud.setFires(flames.getCount());
			
			// Update speedometer needle (rotates from -90° at 0 mph to +90° at 50 mph)
			const speed = Math.max(0, Math.min(50, fe.motion.speed));
			const needleAngle = -90 + (speed / 50) * 180; // -90 to +90 degrees
			speedNeedleEl.setAttribute('transform', `rotate(${needleAngle} 70 80)`);
			speedValueEl.textContent = Math.round(speed);
			

			// If off-road, apply heavy drag
			if (!isPointOnAnyRoad(fe.motion.position)) {
				fe.motion.targetSpeed = Math.max(0, fe.motion.targetSpeed - 12 * dt);
			}

			// State machine for automatic drone firefighting
			
			// DRIVING MODE: When stopped, automatically detect fire and send drone (once per stop)
			if (game.mode === "Driving") {
				const isStopped = fe.motion.speed === 0;
				
				// Track if engine has exceeded 10 mph at least once
				if (!game.hasExceeded10MPH && fe.motion.speed >= 10) {
					game.hasExceeded10MPH = true;
					console.log('🚒 Engine reached 10 MPH - drone firefighting now enabled!');
				}
				
				if (isStopped && !game.hasDispatchedDrone && game.hasExceeded10MPH) {
					// Look for nearest burning house with active flames in front of the engine
					const enginePos = fe.motion.position;
					const engineHeading = fe.root.rotation.y;
					const engineForward = new BABYLON.Vector3(Math.sin(engineHeading), 0, Math.cos(engineHeading));
					
					let nearest = null;
					let nearestDist = Infinity;
					
					houses.forEach(h => {
						if (h.state === "burning") {
							const toHouse = h.mesh.position.subtract(enginePos);
							const dist = toHouse.length();
							
							// Check if house is in front of engine (dot product > 0)
							const dotProduct = BABYLON.Vector3.Dot(toHouse.normalize(), engineForward);
							
							// Only consider houses in front (within 120 degree cone), regardless of flame visibility
							if (dotProduct > -0.5 && dist < nearestDist) {
								nearestDist = dist;
								nearest = h;
							}
						}
					});
					
					// If fire found in front, dispatch drone once
					if (nearest && drone && droneWater) {
						game.mode = "FlyingToFire";
						game.activeHouse = nearest;
						game.droneTargetPos = nearest.mesh.position.clone();
						
						// Calculate hover altitude based on building height
						const bbox = nearest.mesh.getBoundingInfo().boundingBox;
						const buildingHeight = bbox.maximumWorld.y - bbox.minimumWorld.y;
						game.droneTargetPos.y = bbox.maximumWorld.y + Math.max(5, buildingHeight * 0.5); // Above roof
						
						game.hasDispatchedDrone = true; // Mark as dispatched for this stop
						
						// Scale up drone for firefight mode
						drone.scaling.set(2, 2, 2);
						
						hud.setMode("Drone Dispatched");
						hud.msg("Drone flying to fire...");
						console.log('🚁 DRONE DISPATCHED TO FIRE (closest in front)', 'altitude:', game.droneTargetPos.y);
					}
				}
				
				// Reset dispatch flag when engine starts moving again
				if (!isStopped && game.hasDispatchedDrone) {
					game.hasDispatchedDrone = false;
				}
			}
			
			// FLYING TO FIRE MODE: Drone slowly flies to burning building
			else if (game.mode === "FlyingToFire") {
				// Check for open hand - cancel firefighting immediately
				if (game.currentGesture.isOpen) {
					console.log('🚒 OPEN HAND - CANCELLING FIREFIGHT (Flying)');
					game.mode = "Driving";
					hud.setMode("Driving");
					hud.msg("Firefight cancelled - building still burning!");
					// Scale drone back to normal
					if (drone) {
						drone.scaling.set(1, 1, 1);
					}
					game.activeHouse = null;
					game.holdOnTarget = 0;
					game.droneTargetPos = null;
					return;
				}
				
				if (drone && game.droneTargetPos && game.activeHouse) {
					// Store previous position to calculate direction
					const prevPos = drone.position.clone();
					
					// Move drone toward target position slowly
					const lerpSpeed = 1.0; // Slower flight speed for dramatic effect
					const lerp = 1 - Math.exp(-lerpSpeed * dt);
					drone.position = BABYLON.Vector3.Lerp(drone.position, game.droneTargetPos, lerp);
					
					// Rotate drone to face direction of travel (towards fire)
					const velocity = drone.position.subtract(prevPos);
					if (velocity.length() > 0.001) { // Only rotate if moving
						const targetHeading = Math.atan2(velocity.x, velocity.z);
						// Smoothly interpolate rotation
						const rotLerp = 1 - Math.exp(-3 * dt);
						drone.rotation.y = BABYLON.Scalar.Lerp(drone.rotation.y, targetHeading, rotLerp);
					}
					drone.rotation.x = 0;
					drone.rotation.z = 0;
					
					// Check if drone has arrived (within 2 units of target)
					const dist = BABYLON.Vector3.Distance(drone.position, game.droneTargetPos);
					if (dist < 2.0) {
						// Arrived! Start extinguishing and begin camera orbit
						game.mode = "Extinguishing";
						game.cameraOrbitAngle = 0; // Reset orbit angle to start fresh
						hud.setMode("Extinguishing Fire");
						hud.msg("Drone in position - water activated!");
						// Activate water now that we're in position
						if (droneWater) {
							water = droneWater;
							water.setActive(true);
							console.log('🚁 DRONE WATER ACTIVATED');
						}
						game.holdOnTarget = 0;
					}
				}
			}
			
			// EXTINGUISHING MODE: Drone hovers and puts out fire
			else if (game.mode === "Extinguishing") {
				// Check for open hand - cancel firefighting immediately
				if (game.currentGesture.isOpen) {
					console.log('🚒 OPEN HAND - CANCELLING FIREFIGHT (Extinguishing)');
					game.mode = "Driving";
					hud.setMode("Driving");
					hud.msg("Firefight cancelled - building still burning!");
					// Turn off water
					if (water) {
						water.setActive(false);
					}
					water = engineWater;
					// Scale drone back to normal
					if (drone) {
						drone.scaling.set(1, 1, 1);
					}
					game.activeHouse = null;
					game.holdOnTarget = 0;
					game.droneTargetPos = null;
					return;
				}
				
				if (game.activeHouse && game.activeHouse.state === "burning" && drone) {
					const h = game.activeHouse;
					
					// Keep drone hovering over target
					if (game.droneTargetPos) {
						const lerpSpeed = 5; // Hover stabilization
						const lerp = 1 - Math.exp(-lerpSpeed * dt);
						drone.position = BABYLON.Vector3.Lerp(drone.position, game.droneTargetPos, lerp);
					}
					
					// Extinguish fire over 5 seconds
					game.holdOnTarget += dt;
					const progress = Math.min(1, game.holdOnTarget / 5);
					const fireIntensity = 1 - progress;
					flames.reduceIntensity(h, fireIntensity);
					
					hud.msg(`Extinguishing... ${Math.max(0, (5 - game.holdOnTarget)).toFixed(1)}s (${Math.round(progress * 100)}%)`);
					
					if (game.holdOnTarget >= 5) {
						// Fire extinguished!
						fire.extinguish(h);
						game.score += 100;
						hud.setScore(game.score);
						hud.msg("🎉 Fire out! +100 points");
						
						// Mark house as saved - turn green and add permanent rotating star
						const savedMat = new BABYLON.StandardMaterial(`saved_${h.mesh.id}`, scene);
						savedMat.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2); // Green
						savedMat.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.1); // Slight glow
						h.mesh.material = savedMat;
						if (h.roof) {
							const roofMat = new BABYLON.StandardMaterial(`saved_roof_${h.mesh.id}`, scene);
							roofMat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.3);
							h.roof.material = roofMat;
						}
						
						// Add permanent rotating star on top
						showStar(scene, h.mesh, Infinity); // Infinity = never remove
						
					// Play celebration sound
					celebrationSound.currentTime = 0;
					celebrationSound.play().catch(err => console.warn('Audio play failed:', err));
					
					// Scale drone back to normal size
					if (drone) {
						drone.scaling.set(1, 1, 1);
					}
					
					// Turn off water and return to driving mode
					water.setActive(false);
					water = engineWater;
					game.mode = "Driving";
					hud.setMode("Driving");
					game.activeHouse = null;
					game.holdOnTarget = 0;
					game.droneTargetPos = null;
					console.log('🎉 FIRE EXTINGUISHED - RETURNING TO DRIVING MODE');
					}
			} else {
				// House no longer burning or destroyed - return to driving
				// Scale drone back to normal size
				if (drone) {
					drone.scaling.set(1, 1, 1);
				}
				
				water.setActive(false);
				water = engineWater;
				game.mode = "Driving";
				hud.setMode("Driving");
				game.activeHouse = null;
				game.holdOnTarget = 0;
				game.droneTargetPos = null;
			}
			}
		});

		// Stash basic game state (will be expanded)
			window.__GAME__ = { scene, roads, houses, isPointOnAnyRoad, fe, control, game, hud, fire, water };

		// MediaPipe init + gesture mapping
		const video = document.getElementById("inputVideo");
		const handIconEl = document.getElementById("handIcon");
		const handLabelEl = document.getElementById("handLabel");
		
		await initHandTracking(video, {
			onGesture: (g) => {
				if (!g.present) {
					// No hand detected - immediately cancel all firefighting modes and return to driving
					if (game.mode === "FlyingToFire" || game.mode === "Extinguishing") {
						console.log('🚒 NO HAND DETECTED - CANCELLING FIREFIGHT');
						// Turn off water if active
						if (water && water !== engineWater) {
							water.setActive(false);
						}
						water = engineWater;
						// Scale drone back to normal
						if (drone) {
							drone.scaling.set(1, 1, 1);
						}
						// Reset game state
						game.mode = "Driving";
						hud.setMode("Driving");
						hud.msg("No hand detected - firefight cancelled!");
						game.activeHouse = null;
						game.holdOnTarget = 0;
						game.droneTargetPos = null;
					}
					// In all modes, no hand = immediately stop turning and actively brake
					control.throttle = -1; // Negative throttle for active braking
					control.steer = 0;     // Stop turning immediately
					handIconEl.textContent = "✊";
					handLabelEl.textContent = "Stop (No hand)";
					game.currentGesture = { isOpen: false, isFist: false, posX: 0, posY: 0 };
					return;
				}
				
				// Store current gesture for use in game logic
				game.currentGesture = { isOpen: g.isOpen, isFist: g.isFist, posX: g.posX, posY: g.posY };
				
				// Update visual hand state indicator
				let icon = "✋";
				let label = "Open";
				let direction = "";
				
				if (g.isFist) {
					icon = "✊";
					label = "Fist (Stop)";
				} else if (g.isOpen) {
					icon = "✋";
					label = "Open (Go)";
				}
				
			// Show steering direction (flipped: left hand = right turn, right hand = left turn)
			// Use same deadzone threshold as steering logic
			if (g.posX < -0.20) {
				direction = " → RIGHT";
			} else if (g.posX > 0.20) {
				direction = " ← LEFT";
			} else {
				direction = " ↑ STRAIGHT";
			}
				
				handIconEl.textContent = icon;
				handLabelEl.textContent = label + direction;
				
			if (game.mode === "Driving" || game.mode === "Stopped") {
				// Open hand -> go forward, Fist -> stop
				// Hand position (left/right of center) controls steering
				// posX ranges from -0.5 (left) to +0.5 (right)
				// FLIPPED: negative posX (left hand) = positive steer (right turn)
				
				// Add deadzone in center to make driving straight easier
				const deadzone = 0.20; // Hand must be 20% away from center to turn
				const steerScale = 2.0; // Reduced from 2.5 for less sensitivity
				
				let adjustedPosX = g.posX;
				if (Math.abs(g.posX) < deadzone) {
					adjustedPosX = 0; // No steering in deadzone
				} else {
					// Scale the remaining range after deadzone
					adjustedPosX = (Math.abs(g.posX) - deadzone) / (0.5 - deadzone) * Math.sign(g.posX);
				}
				
				control.steer = Math.max(-1, Math.min(1, -adjustedPosX * steerScale));
				
				// Reduce throttle when turning - straight ahead = full speed, turning = reduced speed
				const turnAmount = Math.abs(control.steer); // 0 (straight) to 1 (full turn)
				const straightSpeedMultiplier = 1.0; // Full speed when straight
				const turningSpeedMultiplier = 0.6; // 60% speed when turning hard
				const speedMultiplier = straightSpeedMultiplier - (turnAmount * (straightSpeedMultiplier - turningSpeedMultiplier));
				
				if (g.isOpen) control.throttle = 1.0 * speedMultiplier;
				if (g.isFist) control.throttle = 0.0;
				} else if (game.mode === "Firefight") {
					// Hose aiming: use absolute hand position for direct aiming
					const aimScale = 1.5; // sensitivity multiplier
					aim.yaw = g.posX * aimScale; // -0.5 to +0.5 -> left/right
					aim.pitch = BABYLON.Tools.ToRadians(10) - (g.posY * aimScale); // up/down
					water.setAngles(aim.yaw, aim.pitch);
				}
			}
		});

		// Hide splash and show game
		document.getElementById("cameraPrompt").style.display = "none";

	} catch (err) {
		// Camera permission denied - show detailed help
		console.error("Failed to initialize hand tracking:", err);
		
		// Detect browser for specific instructions
		const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
		const isFirefox = /Firefox/.test(navigator.userAgent);
		const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
		const isEdge = /Edg/.test(navigator.userAgent);
		
		let instructions = "";
		if (isChrome || isEdge) {
			instructions = "1. Click the 🔒 lock icon or ⓘ info icon in the address bar (left of the URL)\n" +
			              "2. Find 'Camera' and change from 'Block' to 'Allow'\n" +
			              "3. Click the reload button below";
		} else if (isFirefox) {
			instructions = "1. Click the 🛡️ permissions icon in the address bar\n" +
			              "2. Enable camera access\n" +
			              "3. Click the reload button below";
		} else if (isSafari) {
			instructions = "1. Safari menu → Settings for this website\n" +
			              "2. Camera: Allow\n" +
			              "3. Click the reload button below";
		} else {
			instructions = "1. Check your browser's address bar for camera permissions\n" +
			              "2. Allow access\n" +
			              "3. Click the reload button below";
		}
		
		document.getElementById("browserHelp").textContent = instructions;
		document.getElementById("permissionHelp").style.display = "block";
		startBtn.textContent = "❌ Camera Access Denied";
		startBtn.style.background = "#999";
		startBtn.disabled = true;
		
		// Add reload button
		const reloadBtn = document.createElement("button");
		reloadBtn.textContent = "🔄 Reload Page";
		reloadBtn.style.cssText = `background: #4CAF50; color: white; border: none; 
		                           padding: 15px 30px; font-size: 16px; font-weight: bold; 
		                           border-radius: 50px; cursor: pointer; margin-top: 20px;
		                           box-shadow: 0 4px 15px rgba(76,175,80,0.4);`;
		reloadBtn.onclick = () => location.reload();
		startBtn.parentElement.appendChild(reloadBtn);
	}
}
