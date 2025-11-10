// Flames manager: uses particle systems for animated flickering flames
// Only creates particle systems when buildings are close to camera for performance
export function createFlameManager(scene) {
	let burningHouses = new Map(); // Map of house.mesh.id -> { house, particleSystems[], hasVisuals }
	
	function showOn(house) {
		if (!house || !house.mesh) return;
		if (burningHouses.has(house.mesh.id)) return;
		
		// Mark as burning but don't create visuals yet (lazy loading for performance)
		burningHouses.set(house.mesh.id, { house, particleSystems: [], hasVisuals: false });
	}
	
	// Update flames - create/destroy particle systems based on proximity to camera
	function update(cameraPosition) {
		const MAX_DISTANCE = 150; // Only show flames within this distance
		
		burningHouses.forEach((entry, houseId) => {
			const house = entry.house;
			const dist = BABYLON.Vector3.Distance(cameraPosition, house.mesh.position);
			
			if (dist < MAX_DISTANCE && !entry.hasVisuals) {
				// Close enough - create particle systems
				createVisualsForHouse(entry);
			} else if (dist >= MAX_DISTANCE && entry.hasVisuals) {
				// Too far - remove particle systems to save performance
				destroyVisualsForHouse(entry);
			}
		});
	}
	
	function createVisualsForHouse(entry) {
		const house = entry.house;
		const bbox = house.mesh.getBoundingInfo().boundingBox;
		const min = bbox.minimumWorld;
		const max = bbox.maximumWorld;
		const center = bbox.centerWorld;
		
		const width = max.x - min.x;
		const height = max.y - min.y;
		const depth = max.z - min.z;
		
		// Create particle systems for this specific house
		const houseSystems = [];
		
		// Multiple layers for bigger fire effect
		houseSystems.push(createFlameParticles(center.x, min.y + 0.5, max.z, width, height * 0.3, 0));
		houseSystems.push(createFlameParticles(center.x, min.y + 0.5, min.z, width, height * 0.3, 0));
		houseSystems.push(createFlameParticles(max.x, min.y + 0.5, center.z, depth, height * 0.3, Math.PI/2));
		houseSystems.push(createFlameParticles(min.x, min.y + 0.5, center.z, depth, height * 0.3, Math.PI/2));
		
		// Mid-level flames for taller buildings
		if (height > 5) {
			houseSystems.push(createFlameParticles(center.x, center.y, max.z, width, height * 0.4, 0));
			houseSystems.push(createFlameParticles(center.x, center.y, min.z, width, height * 0.4, 0));
			houseSystems.push(createFlameParticles(max.x, center.y, center.z, depth, height * 0.4, Math.PI/2));
			houseSystems.push(createFlameParticles(min.x, center.y, center.z, depth, height * 0.4, Math.PI/2));
		}
		
		// Roof flames
		houseSystems.push(createFlameParticles(center.x, max.y, center.z, Math.max(width, depth) * 1.2, height * 0.5, 0));
		
		// Corner flames
		houseSystems.push(createFlameParticles(max.x, min.y, max.z, 2, height * 0.6, 0));
		houseSystems.push(createFlameParticles(min.x, min.y, max.z, 2, height * 0.6, 0));
		houseSystems.push(createFlameParticles(max.x, min.y, min.z, 2, height * 0.6, 0));
		houseSystems.push(createFlameParticles(min.x, min.y, min.z, 2, height * 0.6, 0));
		
		entry.particleSystems = houseSystems;
		entry.hasVisuals = true;
	}
	
	function destroyVisualsForHouse(entry) {
		entry.particleSystems.forEach(ps => {
			if (ps) {
				ps.stop();
				ps.dispose();
			}
		});
		entry.particleSystems = [];
		entry.hasVisuals = false;
	}
	
	function createFlameParticles(x, y, z, span, height, rotationY) {
		// Create particle system with more capacity for bigger fires
		const ps = new BABYLON.ParticleSystem("flames_" + Math.random().toString(36).slice(2), 3000, scene);
		
		// Texture of each particle (using a circular flare)
		ps.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
		
		// Emitter is a box along the span - wider for more coverage
		const emitterBox = new BABYLON.BoxParticleEmitter();
		emitterBox.minEmitBox = new BABYLON.Vector3(-span/2, 0, -0.5);
		emitterBox.maxEmitBox = new BABYLON.Vector3(span/2, height, 0.5);
		ps.particleEmitterType = emitterBox;
		
		// Position the emitter
		ps.emitter = new BABYLON.Vector3(x, y, z);
		
		// Colors - bright orange to yellow to red
		ps.color1 = new BABYLON.Color4(1.0, 0.5, 0.1, 1.0); // Bright orange
		ps.color2 = new BABYLON.Color4(1.0, 0.8, 0.2, 1.0); // Yellow-orange
		ps.colorDead = new BABYLON.Color4(0.6, 0.2, 0.0, 0.0); // Red, transparent
		
		// Bigger particles for more dramatic fire
		ps.minSize = 0.5;
		ps.maxSize = 2.0;
		
		// Longer life time for bigger, lingering flames
		ps.minLifeTime = 0.5;
		ps.maxLifeTime = 1.2;
		
		// Higher emission rate for denser fire
		ps.emitRate = 800;
		
		// Blend mode : BLENDMODE_ADD for additive (bright fire)
		ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
		
		// Direction of each particle after it has been emitted - more upward
		ps.direction1 = new BABYLON.Vector3(-0.7, 1.5, -0.7);
		ps.direction2 = new BABYLON.Vector3(0.7, 3.0, 0.7);
		
		// Angular speed for spinning flames
		ps.minAngularSpeed = 0;
		ps.maxAngularSpeed = Math.PI * 2;
		
		// Higher speed for more energetic flames
		ps.minEmitPower = 2;
		ps.maxEmitPower = 5;
		ps.updateSpeed = 0.01;
		
		// Start the particle system
		ps.start();
		
		return ps;
	}
	
	function hide() {
		// Hide/stop flames for ALL burning houses
		burningHouses.forEach((entry, houseId) => {
			entry.particleSystems.forEach(ps => {
				if (ps) {
					ps.stop();
					ps.dispose();
				}
			});
		});
		burningHouses.clear();
	}
	
	function hideHouse(house) {
		// Hide/stop flames for a specific house
		if (!house || !house.mesh) return;
		
		const entry = burningHouses.get(house.mesh.id);
		if (entry) {
			// Destroy visuals if they exist
			if (entry.hasVisuals) {
				destroyVisualsForHouse(entry);
			}
			burningHouses.delete(house.mesh.id);
		}
	}
	
	function getCount() {
		return burningHouses.size;
	}
	
	function reduceIntensity(house, intensity) {
		// Reduce fire intensity (0 = no fire, 1 = full fire)
		// intensity should be 0-1
		if (!house || !house.mesh) return;
		
		const entry = burningHouses.get(house.mesh.id);
		if (!entry || !entry.hasVisuals) return;
		
		// Adjust emission rate and particle size based on intensity
		entry.particleSystems.forEach(ps => {
			if (ps) {
				ps.emitRate = 800 * intensity; // Scale from 0 to 800
				ps.minSize = 0.5 * intensity;
				ps.maxSize = 2.0 * intensity;
			}
		});
	}
	
	return { showOn, hide, hideHouse, update, getCount, reduceIntensity };
}


