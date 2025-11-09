// Flames, random fire scheduler, water interactions (partial)
export function createFireSystem(scene, houses, opts = {}) {
	const fires = new Map(); // houseId -> { ps, startedAt, timeoutId }
	let current = null;
	let water = null;
	let onDestroyedCb = null;
	const onStartVisual = typeof opts.onStart === "function" ? opts.onStart : null;
	const onStopVisual = typeof opts.onStop === "function" ? opts.onStop : null;

	function startFlame(h) {
		// Visual handled by external flames manager (animated GIF)
		if (onStartVisual) onStartVisual(h);
		fires.set(h.mesh.id, { startedAt: performance.now(), timeoutId: null });
		h.state = "burning";
		current = h;
	}

	function stopFlame(h) {
		if (onStopVisual) onStopVisual();
		if (fires.has(h.mesh.id)) fires.delete(h.mesh.id);
		if (current && current.mesh.id === h.mesh.id) current = null;
	}

	function scheduleNextFire() {
		const delayMs = 8000 + Math.floor(Math.random() * 7000);
		setTimeout(() => {
			// Only select houses currently visible on screen, fallback to any normal if none visible
			let candidates = houses.filter(h => h.state === "normal");
			const cam = scene.activeCamera;
			if (cam && candidates.length > 0) {
				const frustum = cam.getFrustumPlanes();
				const visible = candidates.filter(h => h.mesh && h.mesh.isInFrustum && h.mesh.isInFrustum(frustum));
				if (visible.length > 0) candidates = visible;
			}
			if (candidates.length === 0) return scheduleNextFire();
			const h = candidates[Math.floor(Math.random() * candidates.length)];
			startFlame(h);
			// Failure in 10s if not extinguished
			const tId = setTimeout(() => {
				if (h.state === "burning") {
					markDestroyed(h);
					stopFlame(h);
				}
				scheduleNextFire();
			}, 10000);
			const f = fires.get(h.mesh.id);
			if (f) f.timeoutId = tId;
		}, delayMs);
	}

	function markDestroyed(h) {
		h.state = "destroyed";
		const mat = new BABYLON.StandardMaterial(`destroyed_${h.mesh.id}`, scene);
		mat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);
		mat.specularColor = new BABYLON.Color3(0, 0, 0);
		h.mesh.material = mat;
		if (h.roof) {
			const rmat = new BABYLON.StandardMaterial(`destroyed_roof_${h.mesh.id}`, scene);
			rmat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.15);
			h.roof.material = rmat;
			h.roof.scaling.y = 0.6;
			h.roof.position.y -= 0.4;
		}
		if (typeof onDestroyedCb === "function") {
			onDestroyedCb(h);
		}
	}

	function extinguish(h) {
		h.state = "extinguished";
		stopFlame(h);
		scheduleNextFire();
	}

	// public API
	return {
		igniteRandomLater: scheduleNextFire,
		currentFire: () => current,
		startFlame,
		stopFlame,
		extinguish,
		markDestroyed,
		createWater: (nozzle) => (water = createWaterSystem(scene, nozzle)),
		water: () => water,
		onDestroyed: (cb) => { onDestroyedCb = cb; }
	};
}

// Water particle stream from the engine nozzle
function createWaterSystem(scene, nozzle) {
	let active = false;
	let yaw = 0, pitch = BABYLON.Tools.ToRadians(10); // radians
	const emitter = new BABYLON.TransformNode("water_emitter", scene);
	emitter.parent = nozzle;
	emitter.position = new BABYLON.Vector3(0, 0, 0.2);

	let ps;
	if (BABYLON.GPUParticleSystem.IsSupported) {
		ps = new BABYLON.GPUParticleSystem("water_gpu", { capacity: 1500 }, scene);
	} else {
		ps = new BABYLON.ParticleSystem("water", 1000, scene);
	}
	ps.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
	ps.emitter = emitter;
	ps.minSize = 0.05; ps.maxSize = 0.12;
	ps.minLifeTime = 0.3; ps.maxLifeTime = 0.6;
	ps.emitRate = 1200;
	ps.color1 = new BABYLON.Color4(0.7, 0.8, 1.0, 0.9);
	ps.color2 = new BABYLON.Color4(0.6, 0.7, 1.0, 0.8);
	ps.colorDead = new BABYLON.Color4(0.6, 0.7, 1.0, 0.0);
	ps.gravity = new BABYLON.Vector3(0, -2.5, 0);
	ps.minEmitPower = 8; ps.maxEmitPower = 14;
	ps.updateSpeed = 0.015;

	function aimVector() {
		// Convert yaw/pitch to a forward vector in nozzle space
		const dx = Math.sin(yaw) * Math.cos(pitch);
		const dy = Math.sin(pitch);
		const dz = Math.cos(yaw) * Math.cos(pitch);
		return new BABYLON.Vector3(dx, dy, dz);
	}
	// Update direction each frame
	ps.startDirectionFunction = (worldMatrix, directionToUpdate) => {
		const dir = aimVector();
		const v = BABYLON.Vector3.TransformNormal(dir, worldMatrix);
		directionToUpdate.copyFrom(v.normalize());
	};
	ps.startPositionFunction = (worldMatrix, positionToUpdate) => {
		const p = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(0, 0, 0), worldMatrix);
		positionToUpdate.copyFrom(p);
	};

	function setActive(v) {
		if (v && !active) { ps.start(); }
		if (!v && active) { ps.stop(); }
		active = v;
	}
	function setAngles(yawRad, pitchRad) {
		const maxYaw = BABYLON.Tools.ToRadians(60);
		const maxPitchUp = BABYLON.Tools.ToRadians(35);
		const maxPitchDown = BABYLON.Tools.ToRadians(-5);
		yaw = BABYLON.Scalar.Clamp(yawRad, -maxYaw, maxYaw);
		pitch = BABYLON.Scalar.Clamp(pitchRad, maxPitchDown, maxPitchUp);
	}
	function isHittingHouse(house) {
		// Approximate: ray from emitter along aim vector; check distance to house AABB center and height overlap
		const origin = emitter.getAbsolutePosition();
		const dir = aimVector();
		const toCenter = house.mesh.getAbsolutePosition().subtract(origin);
		const along = BABYLON.Vector3.Dot(toCenter, dir);
		if (along < 0 || along > 30) return false; // range limit
		const closest = origin.add(dir.scale(along));
		const dist = BABYLON.Vector3.Distance(closest, house.mesh.getAbsolutePosition());
		return dist < 3.0; // tolerance radius
	}

	return {
		setActive,
		setAngles,
		isHittingHouse
	};
}


