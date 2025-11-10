// Scene and engine initialization
export function createScene(canvas) {
	const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
	const scene = new BABYLON.Scene(engine);
	scene.clearColor = new BABYLON.Color4(0.53, 0.81, 0.92, 1.0); // Sky blue to match horizon

	// Lighting
	const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
	hemi.intensity = 0.75;
	const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.5, -1, -0.25), scene);
	dir.position = new BABYLON.Vector3(60, 120, 60);
	dir.intensity = 0.6;

	// Default camera (will be replaced by follow camera when engine mesh is created)
	const camera = new BABYLON.ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 80, new BABYLON.Vector3(0, 0, 0), scene);
	camera.lowerRadiusLimit = 30;
	camera.upperRadiusLimit = 200;
	camera.wheelPrecision = 50;
	camera.attachControl(canvas, true);

	// Ground with grass texture
	const cityExtent = 1000;
	const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: cityExtent * 2 + 200, height: cityExtent * 2 + 200, subdivisions: 1 }, scene);
	ground.position.y = -0.05; // Lower slightly to prevent z-fighting with roads
	
	const gmat = new BABYLON.StandardMaterial("groundMat", scene);
	const grassTexture = new BABYLON.Texture("./grass.jpg", scene);
	grassTexture.uScale = (cityExtent * 2 + 200) / 10; // Tile the texture (repeat every 10 units)
	grassTexture.vScale = (cityExtent * 2 + 200) / 10;
	gmat.diffuseTexture = grassTexture;
	gmat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
	ground.material = gmat;
	ground.receiveShadows = true;

	// Resize
	window.addEventListener("resize", () => engine.resize());
	engine.runRenderLoop(() => scene.render());

	return { engine, scene, camera, ground, dir };
}

// Factory for a chase camera that keeps fire engine centered on screen
export function makeFollowCamera(scene, targetMesh) {
	// Use UniversalCamera for better control
	const cam = new BABYLON.UniversalCamera("chaseCam", new BABYLON.Vector3(0, 10, -30), scene);
	cam.maxZ = 3000; // Far clip plane - extend to see more of the city
	cam.minZ = 0.1; // Near clip plane
	
	// Store reference to the fire engine mesh
	cam.targetMesh = targetMesh;
	
	// Custom update function to keep fire engine centered
	cam.updateChaseCam = function(sideRotationOffset = 0) {
		// Get the fire engine's position and rotation
		const enginePos = this.targetMesh.position.clone();
		const engineHeading = this.targetMesh.rotation.y;
		
		// Camera stays fixed distance behind and above the engine
		const distance = 30; // distance behind
		const height = 12; // height above
		
		// Calculate camera position directly behind the engine
		// Add optional side rotation for firefighting mode (0 to PI/4 for 45°)
		const cameraAngle = engineHeading + sideRotationOffset;
		const offsetX = -Math.sin(cameraAngle) * distance;
		const offsetZ = -Math.cos(cameraAngle) * distance;
		
		// Set camera position (no lerp - instant follow for centering)
		this.position.x = enginePos.x + offsetX;
		this.position.y = enginePos.y + height;
		this.position.z = enginePos.z + offsetZ;
		
		// Always look at the fire engine (slightly above center for better view)
		const lookAtPos = enginePos.add(new BABYLON.Vector3(0, 3, 0));
		this.setTarget(lookAtPos);
	};
	
	return cam;
}


