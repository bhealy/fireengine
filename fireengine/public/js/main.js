// Entry point (ES module)
import { createScene, makeFollowCamera } from "./game/scene.js";
import { generateRoads, placeHouses } from "./game/streetGenerator.js";
import { createFireEngine } from "./game/fireEngine.js";
import { createFlameManager } from "./game/flames.js";
import { initHandTracking, startHandTraining, saveHandThresholds } from "./handControl.js";
import { createFireSystem } from "./game/fireSystem.js";
import { showStar } from "./game/ui.js";

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
			mode: "Driving", // Driving | Stopped | Firefight
			score: 0,
			activeHouse: null,
			holdOnTarget: 0,
			rotationProgress: 0, // 0 to 1 for 45 degree rotation animation
			openHandTimer: 0, // Track how long open hand is held in firefight mode
			nearestBurningHouse: null,
			currentGesture: { isOpen: false, isFist: false, posX: 0, posY: 0 }, // Track current hand state
			droneTargetPos: null // Target position for drone in firefight mode
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

		// Water system - create both engine and drone water systems
		const engineWater = fire.createWater(fe.nozzle);
		let droneWater = null; // Will be created after drone loads
		let water = engineWater; // Active water system
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
			
			// Update camera to follow behind fire engine (with optional side rotation)
			const sideViewRotation = game.mode === "Stopped" || game.mode === "Firefight" ? game.rotationProgress : 0;
			cam.updateChaseCam(sideViewRotation);
			
			// Update drone - figure-eight in driving mode, manual control in firefight
			if (drone && game.mode !== "Firefight") {
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
				// Smoothly move toward target
				const lerp = 1 - Math.exp(-4 * dt); // time-constant smoothing
				drone.position = BABYLON.Vector3.Lerp(drone.position, targetPos, lerp);
				// Align drone heading with engine heading
				drone.rotation.x = 0;
				drone.rotation.y = heading;
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

			// State machine for fire engine modes
			
			// DRIVING MODE: Moving around
			if (game.mode === "Driving") {
				// Check if engine is stopped and fist is held for 3 seconds
				const isStopped = fe.motion.speed === 0;
				const isFist = game.currentGesture.isFist;
				
				if (isStopped && isFist) {
					// Increment fist hold timer
					if (!game.fistHoldTimer) game.fistHoldTimer = 0;
					game.fistHoldTimer += dt;
					
					// Show progress message
					const remaining = Math.max(0, 3 - game.fistHoldTimer);
					if (remaining > 0) {
						hud.msg(`Hold fist for ${remaining.toFixed(1)}s to enter firefight mode...`);
					}
					
					// After 3 seconds, find nearest burning house and enter STOPPED mode
					if (game.fistHoldTimer >= 3) {
						let nearest = null;
						let nearestDist = Infinity;
						houses.forEach(h => {
							if (h.state === "burning") {
								const dist = BABYLON.Vector3.Distance(fe.motion.position, h.mesh.position);
								if (dist < nearestDist) {
									nearestDist = dist;
									nearest = h;
								}
							}
						});
						
						if (nearest) {
							game.mode = "Stopped";
							game.nearestBurningHouse = nearest;
							game.rotationProgress = 0;
							game.fistHoldTimer = 0;
							hud.setMode("Stopped - Rotating");
							hud.msg("Preparing water cannon...");
						} else {
							hud.msg("No fires nearby!");
							game.fistHoldTimer = 0;
						}
					}
				} else {
					// Reset timer if not stopped or not holding fist
					game.fistHoldTimer = 0;
					if (isStopped) {
						hud.msg("");
					}
				}
			}
			
			// STOPPED MODE: Switch to drone water and enter firefight
			else if (game.mode === "Stopped") {
				// Immediately enter firefight mode with drone
				game.mode = "Firefight";
				game.activeHouse = game.nearestBurningHouse;
				hud.setMode("Firefight - Drone Control");
				hud.msg("Move your fist to control the drone. Position it over the fire!");
				
				// Switch to drone water system
				if (droneWater) {
					water = droneWater;
					water.setActive(true);
				}
				
				// Initialize drone target position above the fire engine
				game.droneTargetPos = fe.motion.position.clone();
				game.droneTargetPos.y = 15; // Start at altitude
				game.holdOnTarget = 0;
			}
			
			// FIREFIGHT MODE: Control drone with fist position
			else if (game.mode === "Firefight" && game.activeHouse) {
				const h = game.activeHouse;
				
				// Open hand immediately exits firefight mode
				if (game.currentGesture.isOpen) {
					game.mode = "Driving";
					game.rotationProgress = 0;
					hud.setMode("Driving");
					hud.msg("Firefight cancelled - building still burning!");
					water.setActive(false);
					water = engineWater; // Switch back to engine water
					game.activeHouse = null;
					game.holdOnTarget = 0;
					game.droneTargetPos = null;
					return;
				}
				
				// Control drone position with fist movement
				if (game.currentGesture.isFist && game.droneTargetPos && drone) {
					// Map hand position to drone movement
					// posX: -0.5 (left) to +0.5 (right)
					// posY: -0.5 (top) to +0.5 (bottom)
					const moveSpeed = 15; // units per second
					const dx = -game.currentGesture.posX * moveSpeed * dt; // Flipped X for intuitive control
					const dz = game.currentGesture.posY * moveSpeed * dt; // Forward/backward
					
					game.droneTargetPos.x += dx;
					game.droneTargetPos.z += dz;
					
					// Move drone toward target position smoothly
					const lerpSpeed = 3; // smoothing factor
					const lerp = 1 - Math.exp(-lerpSpeed * dt);
					drone.position = BABYLON.Vector3.Lerp(drone.position, game.droneTargetPos, lerp);
				}
				
				if (h.state === "burning") {
					// Check if drone is over the house
					const isOverHouse = water.isHittingHouse(h);
					
					if (isOverHouse) {
						game.holdOnTarget += dt;
						
						// Gradually reduce fire intensity over 5 seconds
						const progress = Math.min(1, game.holdOnTarget / 5);
						const fireIntensity = 1 - progress;
						flames.reduceIntensity(h, fireIntensity);
						
						hud.msg(`Extinguishing... ${Math.max(0, (5 - game.holdOnTarget)).toFixed(1)}s (${Math.round(progress * 100)}%)`);
						
						if (game.holdOnTarget >= 5) {
							// Fire extinguished!
							fire.extinguish(h);
							game.score += 100;
							hud.setScore(game.score);
							hud.msg("Fire out! +100 points.");
							showStar(scene, fe.root, 10);
							// Exit firefight mode
							game.mode = "Driving";
							game.rotationProgress = 0;
							hud.setMode("Driving");
							water.setActive(false);
							water = engineWater; // Switch back to engine water
							game.activeHouse = null;
							game.holdOnTarget = 0;
							game.droneTargetPos = null;
						}
					} else {
						// Not over house - reset progress and restore full fire intensity
						if (game.holdOnTarget > 0) {
							flames.reduceIntensity(h, 1.0);
						}
						game.holdOnTarget = 0;
					}
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
					// No hand = immediately stop turning and actively brake
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
				if (g.posX < -0.15) {
					direction = " → RIGHT";
				} else if (g.posX > 0.15) {
					direction = " ← LEFT";
				} else {
					direction = " ↑ STRAIGHT";
				}
				
				handIconEl.textContent = icon;
				handLabelEl.textContent = label + direction;
				
				if (game.mode === "Driving" || game.mode === "Stopped") {
					// Open hand -> go forward, Fist -> stop
					if (g.isOpen) control.throttle = 1.0;
					if (g.isFist) control.throttle = 0.0;
					// Hand position (left/right of center) controls steering
					// posX ranges from -0.5 (left) to +0.5 (right)
					// FLIPPED: negative posX (left hand) = positive steer (right turn)
					const steerScale = 2.5; // multiplier for sensitivity
					control.steer = Math.max(-1, Math.min(1, -g.posX * steerScale));
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
