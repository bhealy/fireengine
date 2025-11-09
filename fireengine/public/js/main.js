// Entry point (ES module)
import { createScene, makeFollowCamera } from "./game/scene.js";
import { generateRoads, placeHouses } from "./game/streetGenerator.js";
import { createFireEngine } from "./game/fireEngine.js";
import { createFlameManager } from "./game/flames.js";
import { initHandTracking } from "./handControl.js";
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

async function startGame() {
	startBtn.disabled = true;
	startBtn.textContent = "Loading...";
	const t0 = performance.now();
	console.log("🚀 Starting game...");

	const canvas = document.getElementById("renderCanvas");
	if (!canvas) {
		console.error("Canvas not found");
		return;
	}

	try {
		const t1 = performance.now();
		console.log("📦 Creating scene...");
		const { scene } = createScene(canvas);
		console.log(`   ⏱️  Scene created in ${(performance.now() - t1).toFixed(0)}ms`);
		
		// Procedural world
		const t2 = performance.now();
		console.log("🛣️  Generating roads...");
		const { roads, isPointOnAnyRoad } = generateRoads(scene, {});
		console.log(`   ⏱️  Roads generated in ${(performance.now() - t2).toFixed(0)}ms`);
		
		const t3 = performance.now();
		console.log("🏘️  Placing houses...");
		const { houses } = placeHouses(scene, roads, {});
		console.log(`   ⏱️  Houses placed in ${(performance.now() - t3).toFixed(0)}ms (${houses.length} houses)`);

		// Fire system
		const t4 = performance.now();
		console.log("🔥 Creating fire system...");
		const flames = createFlameManager(scene);
		const fire = createFireSystem(scene, houses, {
			onStart: (h) => flames.showOn(h),
			onStop: () => flames.hide()
		});
		fire.igniteRandomLater();
		console.log(`   ⏱️  Fire system created in ${(performance.now() - t4).toFixed(0)}ms`);

		// Fire engine + camera follow (async load)
		const t5 = performance.now();
		console.log("🚒 Loading fire engine model...");
		const fe = await createFireEngine(scene);
		console.log(`   ⏱️  Fire engine loaded in ${(performance.now() - t5).toFixed(0)}ms`);
		const cam = makeFollowCamera(scene, fe.root);
		scene.activeCamera = cam;
		cam.attachControl(canvas, true);

		// Control surface (will be driven by hand gestures later)
		const control = {
			throttle: 0,     // 0..1
			steer: 0         // -1..+1
		};

		// Game HUD and mode
		const game = {
			mode: "Driving", // Driving | Firefight
			score: 0,
			activeHouse: null,
			holdOnTarget: 0
		};
		let aim = { yaw: 0, pitch: BABYLON.Tools.ToRadians(10) };
		const hud = {
			scoreEl: document.getElementById("score"),
			modeEl: document.getElementById("mode"),
			msgEl: document.getElementById("messages"),
			setScore(v) { this.scoreEl.textContent = `Score: ${v}`; },
			setMode(v) { this.modeEl.textContent = `Mode: ${v}`; },
			msg(t) { this.msgEl.textContent = t || ""; }
		};
		hud.setScore(0);
		hud.setMode("Driving");

		// Water system (requires engine nozzle) and failure hook
		const water = fire.createWater(fe.nozzle);
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
			// Drive-logic: map control to motion (max speed now 100 mph)
			const maxSpeed = 100; // mph
			fe.motion.targetSpeed = Math.max(0, Math.min(1, control.throttle)) * maxSpeed;
			fe.motion.steer = BABYLON.Scalar.Clamp(control.steer, -1, 1) * fe.motion.maxSteer;

			fe.update(dt);
			
			// Update camera to follow behind fire engine
			cam.updateChaseCam();
			
			// Update speedometer needle (rotates from -90° at 0 mph to +90° at 100 mph)
			const speed = Math.max(0, Math.min(100, fe.motion.speed));
			const needleAngle = -90 + (speed / 100) * 180; // -90 to +90 degrees
			speedNeedleEl.setAttribute('transform', `rotate(${needleAngle} 70 80)`);
			speedValueEl.textContent = Math.round(speed);
			
			// Debug logging every 60 frames (~1 second)
			debugFrameCount++;
			if (debugFrameCount % 60 === 0) {
				console.log('🎮 Controls:', {
					throttle: control.throttle.toFixed(2),
					steer: control.steer.toFixed(2),
					targetSpeed: fe.motion.targetSpeed.toFixed(2),
					actualSpeed: fe.motion.speed.toFixed(2),
					position: `(${fe.motion.position.x.toFixed(1)}, ${fe.motion.position.z.toFixed(1)})`,
					heading: (fe.motion.heading * 180 / Math.PI).toFixed(1) + '°'
				});
			}

			// If off-road, apply heavy drag
			if (!isPointOnAnyRoad(fe.motion.position)) {
				fe.motion.targetSpeed = Math.max(0, fe.motion.targetSpeed - 12 * dt);
			}

			// Proximity gate to enter Firefighting mode
			if (game.mode === "Driving") {
				const burning = fire.currentFire && fire.currentFire();
				if (burning && burning.state === "burning") {
					const dist = BABYLON.Vector3.Distance(fe.motion.position, burning.mesh.position);
					if (dist < 10 && fe.motion.speed < 0.5 && isPointOnAnyRoad(fe.motion.position)) {
						game.mode = "Firefight";
						game.activeHouse = burning;
						hud.setMode("Firefight");
						hud.msg("Aim the hose with your hand (left/right/up/down). Keep water on flames for 5s.");
						// Stop the engine
						control.throttle = 0;
						fe.motion.targetSpeed = 0;
						aim = { yaw: 0, pitch: BABYLON.Tools.ToRadians(10) };
						water.setAngles(aim.yaw, aim.pitch);
						water.setActive(true);
					}
				}
			}

			// Firefight loop: check hit and hold timing
			if (game.mode === "Firefight" && game.activeHouse) {
				const h = game.activeHouse;
				if (h.state === "burning") {
					if (water.isHittingHouse(h)) {
						game.holdOnTarget += dt;
						hud.msg(`Hold steady... ${Math.max(0, (5 - game.holdOnTarget)).toFixed(1)}s`);
						if (game.holdOnTarget >= 5) {
							fire.extinguish(h);
							game.score += 100;
							hud.setScore(game.score);
							hud.msg("Fire out! +100 points.");
							showStar(scene, fe.root, 10);
							game.mode = "Driving";
							hud.setMode("Driving");
							water.setActive(false);
							game.activeHouse = null;
							game.holdOnTarget = 0;
						}
					} else {
						game.holdOnTarget = 0;
					}
				}
			}
		});

		// Stash basic game state (will be expanded)
		window.__GAME__ = { scene, roads, houses, isPointOnAnyRoad, fe, control, game, hud, fire, water };

		// MediaPipe init + gesture mapping
		const t6 = performance.now();
		console.log("📹 Requesting camera access...");
		const video = document.getElementById("inputVideo");
		let gestureDebugCount = 0;
		const handIconEl = document.getElementById("handIcon");
		const handLabelEl = document.getElementById("handLabel");
		
		await initHandTracking(video, {
			onGesture: (g) => {
				if (!g.present) {
					// No hand = stop/brake (same as fist)
					control.throttle = 0;
					control.steer = 0;
					handIconEl.textContent = "✊";
					handLabelEl.textContent = "Stop (No hand)";
					return;
				}
				
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
				
				// Show steering direction
				if (g.posX < -0.15) {
					direction = " ← LEFT";
				} else if (g.posX > 0.15) {
					direction = " → RIGHT";
				} else {
					direction = " ↑ STRAIGHT";
				}
				
				handIconEl.textContent = icon;
				handLabelEl.textContent = label + direction;
				
				// Debug gesture detection every 30 calls (~0.5s)
				gestureDebugCount++;
				if (gestureDebugCount % 30 === 0) {
					console.log('👋 Gesture:', {
						isOpen: g.isOpen,
						isFist: g.isFist,
						posX: g.posX?.toFixed(2),
						posY: g.posY?.toFixed(2)
					});
				}
				
				if (game.mode === "Driving") {
					// Open hand -> go forward, Fist -> stop
					if (g.isOpen) control.throttle = 1.0;
					if (g.isFist) control.throttle = 0.0;
					// Hand position (left/right of center) controls steering
					// posX ranges from -0.5 (left) to +0.5 (right)
					const steerScale = 2.5; // multiplier for sensitivity
					control.steer = Math.max(-1, Math.min(1, g.posX * steerScale));
				} else if (game.mode === "Firefight") {
					// Hose aiming: accumulate yaw/pitch deltas from hand motion
					const aimScale = 2.0; // radians per normalized unit
					aim.yaw += g.dx * aimScale;
					aim.pitch -= g.dy * aimScale;
					water.setAngles(aim.yaw, aim.pitch);
				}
			}
		});

		console.log(`   ⏱️  Camera initialized in ${(performance.now() - t6).toFixed(0)}ms`);
		
		// Hide splash and show game
		document.getElementById("cameraPrompt").style.display = "none";
		
		const totalTime = performance.now() - t0;
		console.log(`\n✅ Game started successfully! Total load time: ${totalTime.toFixed(0)}ms (${(totalTime/1000).toFixed(2)}s)\n`);

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
