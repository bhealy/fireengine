// Fire engine mesh loading from .babylon file
export async function createFireEngine(scene) {
	const root = new BABYLON.TransformNode("fireEngineRoot", scene);

	// Load the fire engine model (relative path for GitHub Pages)
	try {
		const result = await BABYLON.SceneLoader.ImportMeshAsync("", "./", "fire_engine.babylon", scene);
		// Ensure ALL top-level nodes (meshes AND transform nodes) are parented to our root.
		// Some GLTF/Babylon models include a top-level TransformNode that owns all meshes;
		// those meshes would already have a parent, so we must also re-parent transform nodes.
		const topLevelMeshes = result.meshes.filter(m => !m.parent);
		const topLevelTransforms = (result.transformNodes || []).filter(t => !t.parent);
		[...topLevelMeshes, ...topLevelTransforms].forEach(n => { n.parent = root; });
		console.log("Fire engine loaded:", result.meshes.length, "meshes");
	} catch (err) {
		console.error("Failed to load fire_engine.babylon:", err);
		// Fallback: create a simple box so game doesn't crash
		const fallback = BABYLON.MeshBuilder.CreateBox("fe_fallback", { size: 2 }, scene);
		fallback.material = makeMat(scene, new BABYLON.Color3(0.8, 0.1, 0.1));
		fallback.parent = root;
	}

	// Load brake sound (relative path for GitHub Pages)
	const brakeSound = new Audio('./fast-car-braking-sound-effect-3-11000.mp3');
	brakeSound.loop = false;
	brakeSound.volume = 0.5;
	let brakeSoundPlaying = false;

	// Load siren sound (relative path for GitHub Pages)
	const sirenSound = new Audio('./firetruck-78910.mp3');
	sirenSound.loop = true;
	sirenSound.volume = 0.6;
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
		const accel = 3.0; // Slower acceleration for smoother control
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
		const minTurnSpeed = 0.3;
		const speedFactor = Math.max(minTurnSpeed, motion.speed / 10.0);
		const steerFactor = motion.steer * speedFactor;
		motion.heading += steerFactor * dtSec;

		// Move forward
		const forward = new BABYLON.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
		const moveAmount = forward.scale(motion.speed * dtSec);
		motion.position.addInPlace(moveAmount);
		root.position.copyFrom(motion.position);
		root.rotation.y = motion.heading;
		
		// Debug logging every 60 frames
		motion.debugCounter++;
		if (motion.debugCounter % 60 === 0) {
			console.log('🚒 Fire Engine:', {
				speed: motion.speed.toFixed(2),
				targetSpeed: motion.targetSpeed.toFixed(2),
				steer: motion.steer.toFixed(2),
				'motion.position': `(${motion.position.x.toFixed(1)}, ${motion.position.z.toFixed(1)})`,
				'root.position': `(${root.position.x.toFixed(1)}, ${root.position.z.toFixed(1)})`,
				'root.absolutePosition': `(${root.getAbsolutePosition().x.toFixed(1)}, ${root.getAbsolutePosition().z.toFixed(1)})`,
				moveAmount: moveAmount.length().toFixed(3),
				heading: (motion.heading * 180 / Math.PI).toFixed(1) + '°'
			});
		}
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


