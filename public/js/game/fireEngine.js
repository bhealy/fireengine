// Fire engine mesh loading from .babylon file
import { loadAudioSettings } from "../audioSettings.js";

export async function createFireEngine(scene) {
	const root = new BABYLON.TransformNode("fireEngineRoot", scene);

	// Load the fire engine model (relative path for GitHub Pages)
	try {
		const result = await BABYLON.SceneLoader.ImportMeshAsync("", "./", "low_poly_fire_truck.glb", scene);
		// Ensure the ENTIRE imported model follows `root` by re-parenting the unique
		// top-most ancestors to `root` while preserving world transforms.
		// We'll then move them under a `visual` node that can carry a fixed orientation offset.
		function topAncestor(node) {
			let n = node;
			while (n && n.parent) n = n.parent;
			return n;
		}
		function reparentPreserveWorld(node, newParent) {
			try {
				const wm = node.computeWorldMatrix(true);
				const s = new BABYLON.Vector3();
				const q = new BABYLON.Quaternion();
				const p = new BABYLON.Vector3();
				wm.decompose(s, q, p);
				node.parent = newParent;
				node.position.copyFrom(p);
				if (node.rotationQuaternion) {
					node.rotationQuaternion.copyFrom(q);
				} else {
					const e = q.toEulerAngles();
					node.rotation.set(e.x, e.y, e.z);
				}
				node.scaling.copyFrom(s);
			} catch (e) {
				node.parent = newParent;
			}
		}
		const candidates = [
			...(result.meshes || []),
			...((result.transformNodes || []))
		];
		const ancestors = new Map(); // top -> true
		candidates.forEach(n => {
			const top = topAncestor(n);
			if (top && top !== root) ancestors.set(top, true);
		});
		ancestors.forEach((_, n) => {
			reparentPreserveWorld(n, root);
		});
		
		// Create a visual container under root to allow a fixed orientation offset
		const visual = new BABYLON.TransformNode("fireEngineVisual", scene);
		visual.parent = root;
		// Move the imported ancestors under `visual` (keep world transforms stable because visual == identity)
		ancestors.forEach((_, n) => { n.parent = visual; });
		
		// Auto-detect forward axis and apply yaw offset so model points along +Z when heading=0.
		let yawOffset = 0;
		try {
			const meshes = visual.getChildMeshes ? visual.getChildMeshes() : [];
			if (meshes.length > 0) {
				let minW = new BABYLON.Vector3( Infinity,  Infinity,  Infinity);
				let maxW = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
				for (const m of meshes) {
					if (!m.getBoundingInfo) continue;
					const bb = m.getBoundingInfo().boundingBox;
					minW = BABYLON.Vector3.Minimize(minW, bb.minimumWorld);
					maxW = BABYLON.Vector3.Maximize(maxW, bb.maximumWorld);
				}
				const sizeX = maxW.x - minW.x;
				const sizeZ = maxW.z - minW.z;
				// If the model is longer in X than Z, assume it faces +X and rotate -90° so +X -> +Z.
				if (sizeX > sizeZ * 1.05) {
					yawOffset = -Math.PI / 2;
				} else {
					yawOffset = 0; // already roughly along Z
				}
			}
		} catch (e) {
			// Silent fail
		}
		visual.rotation.y = yawOffset;
	} catch (err) {
		console.error("Failed to load low_poly_fire_truck.glb:", err);
		// Fallback: create a simple box so game doesn't crash
		const fallback = BABYLON.MeshBuilder.CreateBox("fe_fallback", { size: 2 }, scene);
		fallback.material = makeMat(scene, new BABYLON.Color3(0.8, 0.1, 0.1));
		fallback.parent = root;
	}

	// Load saved audio settings for sound effects
	const audioSettings = loadAudioSettings();
	const sfxVolume = audioSettings.sfxVolume / 100; // Convert percentage to 0-1

	// Load brake sound (relative path for GitHub Pages)
	const brakeSound = new Audio('./fast-car-braking-sound-effect-3-11000.mp3');
	brakeSound.loop = false;
	brakeSound.volume = sfxVolume * 0.5; // 50% of user's SFX volume
	let brakeSoundPlaying = false;

	// Load siren sound (relative path for GitHub Pages)
	const sirenSound = new Audio('./firetruck-78910.mp3');
	sirenSound.loop = true;
	sirenSound.volume = sfxVolume * 0.6; // 60% of user's SFX volume
	let sirenSoundPlaying = false;

	// Hose/nozzle anchor (front bumper) - adjust position as needed based on actual model
	const nozzle = new BABYLON.TransformNode("fe_nozzle", scene);
	nozzle.position.set(0, 1.2, 2.4);
	nozzle.parent = root;

	// State for motion (filled by drive-logic)
	const motion = {
		speed: 0,          // units/s
		targetSpeed: 0,
		steer: 0,          // radians (-left/+right)
		maxSteer: BABYLON.Tools.ToRadians(35),
		heading: 0,        // radians world yaw
		position: new BABYLON.Vector3(0, 0, 0),
		isBraking: false,  // track braking state for sound
		sirenPlaying: false, // track siren state
		debugCounter: 0    // for debug logging
	};

	function update(dtSec) {
		// Basic acceleration/braking (braking 3x faster than acceleration)
		const accel = 6.0; // Doubled from 3.0 for faster straight-line acceleration
		const brake = 9.0; // 3x faster braking
		
		// Check if we're turning (steer threshold)
		const steerAmount = Math.abs(motion.steer / motion.maxSteer); // 0 to 1
		const isTurning = steerAmount > 0.05; // More than 5% steer input
		
		// If turning, no acceleration allowed - only maintain or reduce speed
		if (isTurning) {
			// Apply turn braking - the harder the turn, the more braking
			const turnBrake = steerAmount * 2.0; // Up to 2 units/s² braking when fully turning
			motion.speed = Math.max(0, motion.speed - turnBrake * dtSec);
			
			// Also apply regular braking if targetSpeed is lower
			if (motion.targetSpeed < motion.speed) {
				const diff = motion.targetSpeed - motion.speed;
				const step = BABYLON.Scalar.Clamp(diff, -brake * dtSec, 0);
				motion.speed += step;
			}
		} else {
			// Not turning - normal acceleration/braking
			const diff = motion.targetSpeed - motion.speed;
			const rate = diff < 0 ? brake : accel;
			const step = BABYLON.Scalar.Clamp(diff, -rate * dtSec, rate * dtSec);
			motion.speed += step;
		}
		
		// Detect braking (targetSpeed < currentSpeed) and play/stop brake sound
		const isBrakingNow = (motion.targetSpeed < motion.speed - 1) && motion.speed > 5; // Only if moving
		if (isBrakingNow && !motion.isBraking) {
			// Start braking
			motion.isBraking = true;
			if (!brakeSoundPlaying) {
				brakeSound.currentTime = 0;
				brakeSound.play().then(() => {
					brakeSoundPlaying = true;
					// Allow stopping after sound starts
					brakeSound.onended = () => { brakeSoundPlaying = false; };
				}).catch(err => console.log('Brake sound play failed:', err));
			}
		} else if (!isBrakingNow && motion.isBraking) {
			// Stop braking
			motion.isBraking = false;
			if (brakeSoundPlaying && brakeSound.currentTime > 0.1) {
				brakeSound.pause();
				brakeSoundPlaying = false;
			}
		}

		// Play siren when speed > 10
		const shouldPlaySiren = motion.speed > 10;
		if (shouldPlaySiren && !motion.sirenPlaying) {
			// Start siren
			motion.sirenPlaying = true;
			if (!sirenSoundPlaying) {
				sirenSound.play().then(() => {
					sirenSoundPlaying = true;
				}).catch(err => console.log('Siren sound play failed:', err));
			}
		} else if (!shouldPlaySiren && motion.sirenPlaying) {
			// Stop siren
			motion.sirenPlaying = false;
			if (sirenSoundPlaying) {
				sirenSound.pause();
				sirenSound.currentTime = 0;
				sirenSoundPlaying = false;
			}
		}

		// Heading change from steering (works even at low speeds)
		// Minimum turn rate so steering works when slow/stopped
		const minTurnSpeed = 0.6; // Doubled from 0.3 for faster turning
		const speedFactor = Math.max(minTurnSpeed, motion.speed / 5.0); // Changed from /10.0 to /5.0 to double turn speed
		const steerFactor = motion.steer * speedFactor;
		motion.heading += steerFactor * dtSec;

		// Move forward
		const forward = new BABYLON.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
		const moveAmount = forward.scale(motion.speed * dtSec);
		motion.position.addInPlace(moveAmount);
		root.position.copyFrom(motion.position);
		root.rotation.y = motion.heading;
	}

	return {
		root,
		nozzle,
		motion,
		update
	};
}

function makeMat(scene, color) {
	const m = new BABYLON.StandardMaterial(`m_${Math.random().toString(36).slice(2)}`, scene);
	m.diffuseColor = color;
	m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
	return m;
}


