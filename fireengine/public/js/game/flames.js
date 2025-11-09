// Flames manager: covers building with animated flame billboards
export function createFlameManager(scene) {
	let currentHouse = null;
	let flamePlanes = []; // Store flame planes for cleanup
	let sharedFlameTexture = null; // Share one animated texture across all planes for performance
	
	function showOn(house) {
		if (!house || !house.mesh) { 
			console.log("🔥 Flames: No house or mesh provided");
			hide(); 
			return; 
		}
		
		// Don't reapply if already on fire
		if (currentHouse === house) {
			console.log("🔥 Flames: House already on fire, skipping");
			return;
		}
		
		// Hide previous flames
		hide();
		
		currentHouse = house;
		
		// Create shared animated texture if not exists
		if (!sharedFlameTexture) {
			sharedFlameTexture = createAnimatedFlameTexture(scene);
		}
		
		// Get bounding box of the house
		const bbox = house.mesh.getBoundingInfo().boundingBox;
		const min = bbox.minimumWorld;
		const max = bbox.maximumWorld;
		const center = bbox.centerWorld;
		
		const width = max.x - min.x;
		const height = max.y - min.y;
		const depth = max.z - min.z;
		
		console.log("🔥 Flames: Creating flame planes for house", {
			center: `(${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)})`,
			dimensions: `${width.toFixed(1)} x ${height.toFixed(1)} x ${depth.toFixed(1)}`
		});
		
		// Create flame planes for each face of the bounding box
		// Each plane uses the shared animated texture
		
		// Front face (+Z)
		createFlamePlane(center.x, center.y, max.z + 0.1, width, height, 0);
		
		// Back face (-Z)
		createFlamePlane(center.x, center.y, min.z - 0.1, width, height, Math.PI);
		
		// Right face (+X)
		createFlamePlane(max.x + 0.1, center.y, center.z, depth, height, -Math.PI / 2);
		
		// Left face (-X)
		createFlamePlane(min.x - 0.1, center.y, center.z, depth, height, Math.PI / 2);
		
		// Top face (roof)
		createFlamePlane(center.x, max.y + 0.1, center.z, width, depth, 0, true);
		
		console.log(`🔥 Flames: Created ${flamePlanes.length} flame planes`);
	}
	
	// Create animated flame texture using canvas to render GIF frames
	function createAnimatedFlameTexture(scene) {
		// Create canvas for drawing GIF
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 512;
		const ctx = canvas.getContext('2d');
		
		// Load GIF as image
		const img = new Image();
		img.src = './flames.gif';
		
		// Create dynamic texture from canvas
		const texture = new BABYLON.DynamicTexture("flameTexture", canvas, scene, false);
		texture.hasAlpha = true;
		texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
		texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
		
		// Animation loop - redraw GIF to canvas and update texture
		let animationRunning = true;
		function animate() {
			if (!animationRunning) return;
			
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			texture.update();
			
			requestAnimationFrame(animate);
		}
		
		// Start animation when image loads
		img.onload = () => {
			console.log('🔥 Flames GIF loaded, starting animation');
			animate();
		};
		
		// Store cleanup function
		texture.onDisposeObservable.add(() => {
			animationRunning = false;
		});
		
		return texture;
	}
	
	function createFlamePlane(x, y, z, width, height, rotationY, isRoof = false) {
		const plane = BABYLON.MeshBuilder.CreatePlane(
			"flamePlane_" + Math.random().toString(36).slice(2), 
			{ width: width, height: height }, 
			scene
		);
		
		plane.position.set(x, y, z);
		plane.rotation.y = rotationY;
		
		// Rotate roof plane to lay flat
		if (isRoof) {
			plane.rotation.x = Math.PI / 2;
		}
		
		plane.isPickable = false;
		plane.renderingGroupId = 1; // Render after buildings to ensure visibility
		
		// Create material with shared animated texture
		const mat = new BABYLON.StandardMaterial("flamePlaneMat_" + Math.random().toString(36).slice(2), scene);
		mat.diffuseTexture = sharedFlameTexture;
		mat.emissiveTexture = sharedFlameTexture;
		mat.emissiveColor = new BABYLON.Color3(1.0, 0.8, 0.3);
		mat.opacityTexture = sharedFlameTexture;
		mat.backFaceCulling = false;
		mat.disableLighting = true;
		plane.material = mat;
		
		console.log(`🔥 Created flame plane at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}), size ${width.toFixed(1)}x${height.toFixed(1)}, rot ${(rotationY * 180 / Math.PI).toFixed(0)}°`);
		
		flamePlanes.push(plane);
	}
	
	function hide() {
		if (!currentHouse) return;
		
		// Dispose all flame planes
		flamePlanes.forEach(plane => {
			if (plane && !plane.isDisposed()) {
				plane.dispose();
			}
		});
		flamePlanes = [];
		currentHouse = null;
	}
	
	return { showOn, hide };
}


