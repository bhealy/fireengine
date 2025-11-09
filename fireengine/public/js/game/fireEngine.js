// Fire engine mesh loading from .babylon file
export async function createFireEngine(scene) {
	const root = new BABYLON.TransformNode("fireEngineRoot", scene);

	// Load the fire engine model
	try {
		const result = await BABYLON.SceneLoader.ImportMeshAsync("", "/", "fire_engine.babylon", scene);
		// Parent all loaded meshes to root
		result.meshes.forEach(mesh => {
			if (!mesh.parent) {
				mesh.parent = root;
			}
		});
		console.log("Fire engine loaded:", result.meshes.length, "meshes");
	} catch (err) {
		console.error("Failed to load fire_engine.babylon:", err);
		// Fallback: create a simple box so game doesn't crash
		const fallback = BABYLON.MeshBuilder.CreateBox("fe_fallback", { size: 2 }, scene);
		fallback.material = makeMat(scene, new BABYLON.Color3(0.8, 0.1, 0.1));
		fallback.parent = root;
	}

	// Load brake sound
	const brakeSound = new Audio('/fast-car-braking-sound-effect-3-11000.mp3');
	brakeSound.loop = false;
	brakeSound.volume = 0.5;

	// Load siren sound
	const sirenSound = new Audio('/firetruck-78910.mp3');
	sirenSound.loop = true;
	sirenSound.volume = 0.6;

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
		sirenPlaying: false // track siren state
	};

	function update(dtSec) {
		// Basic acceleration/braking (braking 3x faster than acceleration)
		const accel = 3.0; // Slower acceleration for smoother control
		const brake = 9.0; // 3x faster braking
		
		// Turning causes active braking - the harder the turn, the more braking
		// About half the forward acceleration speed (1.5 units/s²)
		const steerAmount = Math.abs(motion.steer / motion.maxSteer); // 0 to 1
		const turnBrake = steerAmount * 1.5; // Up to 1.5 units/s² braking when fully turning
		
		// Apply turn braking to current speed
		motion.speed = Math.max(0, motion.speed - turnBrake * dtSec);
		
		// Then handle regular acceleration/braking
		const diff = motion.targetSpeed - motion.speed;
		const rate = diff < 0 ? brake : accel;
		const step = BABYLON.Scalar.Clamp(diff, -rate * dtSec, rate * dtSec);
		motion.speed += step;
		
		// Detect braking (targetSpeed < currentSpeed) and play/stop brake sound
		const isBrakingNow = (motion.targetSpeed < motion.speed - 1) && motion.speed > 5; // Only if moving
		if (isBrakingNow && !motion.isBraking) {
			// Start braking
			brakeSound.currentTime = 0;
			brakeSound.play().catch(err => console.log('Brake sound play failed:', err));
			motion.isBraking = true;
		} else if (!isBrakingNow && motion.isBraking) {
			// Stop braking
			brakeSound.pause();
			motion.isBraking = false;
		}

		// Play siren when speed > 10
		const shouldPlaySiren = motion.speed > 10;
		if (shouldPlaySiren && !motion.sirenPlaying) {
			// Start siren
			sirenSound.play().catch(err => console.log('Siren sound play failed:', err));
			motion.sirenPlaying = true;
		} else if (!shouldPlaySiren && motion.sirenPlaying) {
			// Stop siren
			sirenSound.pause();
			sirenSound.currentTime = 0;
			motion.sirenPlaying = false;
		}

		// Heading change from steering (works even at low speeds)
		// Minimum turn rate so steering works when slow/stopped
		const minTurnSpeed = 0.3;
		const speedFactor = Math.max(minTurnSpeed, motion.speed / 10.0);
		const steerFactor = motion.steer * speedFactor;
		motion.heading += steerFactor * dtSec;

		// Move forward
		const forward = new BABYLON.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
		motion.position.addInPlace(forward.scale(motion.speed * dtSec));
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


