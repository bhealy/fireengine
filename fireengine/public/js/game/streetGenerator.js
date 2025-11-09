// Procedural road generation and on-road checks
export function generateRoads(scene, options = {}) {
	// Manhattan-style grid
	const extent = options.extent ?? 1000;
	const majorSpacing = options.majorSpacing ?? 160;
	const minorSpacing = options.minorSpacing ?? 64;
	const majorWidth = options.majorWidth ?? 14;
	const minorWidth = options.minorWidth ?? 8;
	
	const roadMat = makeRoadMaterial(scene);
	const roads = [];
	
	function generateGridPositions(min, max, spacing) {
		const out = [];
		for (let v = Math.ceil(min / spacing) * spacing; v <= max; v += spacing) out.push(v);
		return out;
	}
	function isMajorCoord(v) {
		// Numerical tolerance to account for float drift
		const r = ((v % majorSpacing) + majorSpacing) % majorSpacing;
		return Math.abs(r) < 1e-6 || Math.abs(r - majorSpacing) < 1e-6;
	}
	
	const xsMinor = generateGridPositions(-extent, extent, minorSpacing);
	const xsMajor = generateGridPositions(-extent, extent, majorSpacing);
	const zsMinor = generateGridPositions(-extent, extent, minorSpacing);
	const zsMajor = generateGridPositions(-extent, extent, majorSpacing);
	
	// Vertical roads (along Z): create rectangles with length on X then rotate by 90deg
	const allXs = new Set([...xsMinor, ...xsMajor]);
	for (const x of allXs) {
		const isMajor = isMajorCoord(x);
		const width = isMajor ? majorWidth : minorWidth;
		const length = extent * 2 + 2;
		const mesh = BABYLON.MeshBuilder.CreateGround(`road_v_${x}`, { width: length, height: width }, scene);
		mesh.position.set(x, 0.01, 0);
		mesh.rotation = new BABYLON.Vector3(0, Math.PI / 2, 0); // align length with world Z
		mesh.material = roadMat;
		mesh.receiveShadows = true;
		
		const yaw = Math.PI / 2;
		const cos = Math.cos(yaw), sin = Math.sin(yaw);
		const rec = {
			mesh,
			center: mesh.position.clone(),
			length: length,
			width: width,
			yaw,
			cos, sin,
			halfL: length / 2,
			halfW: width / 2,
			orientation: "vertical",
			isMajor
		};
		addRoadMarkings(scene, rec, extent);
		roads.push(rec);
	}
	
	// Horizontal roads (along X): length on X (no rotation)
	const allZs = new Set([...zsMinor, ...zsMajor]);
	for (const z of allZs) {
		const isMajor = isMajorCoord(z);
		const width = isMajor ? majorWidth : minorWidth;
		const length = extent * 2 + 2;
		const mesh = BABYLON.MeshBuilder.CreateGround(`road_h_${z}`, { width: length, height: width }, scene);
		mesh.position.set(0, 0.01, z);
		mesh.rotation = new BABYLON.Vector3(0, 0, 0);
		mesh.material = roadMat;
		mesh.receiveShadows = true;
		
		const yaw = 0;
		const cos = Math.cos(yaw), sin = Math.sin(yaw);
		const rec = {
			mesh,
			center: mesh.position.clone(),
			length: length,
			width: width,
			yaw,
			cos, sin,
			halfL: length / 2,
			halfW: width / 2,
			orientation: "horizontal",
			isMajor
		};
		addRoadMarkings(scene, rec, extent);
		roads.push(rec);
	}
	
	function isPointOnAnyRoad(pos) {
		for (const r of roads) {
			// Transform point into road-local coords
			const dx = pos.x - r.center.x;
			const dz = pos.z - r.center.z;
			const localX = dx * r.cos + dz * r.sin;   // along road length axis
			const localZ = -dx * r.sin + dz * r.cos;  // across road width axis
			if (Math.abs(localX) <= r.halfL && Math.abs(localZ) <= r.halfW) {
				return true;
			}
		}
		return false;
	}
	
	return { roads, isPointOnAnyRoad };
}

export function placeHouses(scene, roads, options = {}) {
	const rng = seeded(options.seed || Math.floor(Math.random() * 1e9) + 42);
	const houses = [];
	const maxHouses = options.maxHouses ?? 350;
	let totalHouses = 0;
	
	// Available house GLBs at web root (served from /public) - relative paths for GitHub Pages
	const HOUSE_MODELS = [
		"./house.glb",
		"./farm_house.glb",
		"./medieval_house.glb",
		"./old_house.glb",
		"./old_russian_house.glb",
		"./korean_bakery.glb",
		"./mushroom_house.glb",
		"./stilized_house.glb",
		"./housestation.glb",
		"./vianney_house_2.glb",
		"./tower_house_design.glb",
		"./dae_final_assignment_milestone_house.glb",
		"./house (1).glb"
		// Intentionally exclude very large: "./house_home_-_53mb.glb"
	];
	const houseCache = new Map(); // url -> TransformNode (source)
	async function instantiateHouse(url, position, scale = 1) {
		function splitUrl(u) {
			let p = u;
			// Handle both absolute (/) and relative (./) paths
			if (p.startsWith("/")) p = p.slice(1);
			if (p.startsWith("./")) p = p.slice(2);
			const idx = p.lastIndexOf("/");
			if (idx >= 0) {
				return { rootUrl: "./" + p.slice(0, idx + 1), fileName: p.slice(idx + 1) };
			}
			return { rootUrl: "./", fileName: p };
		}
		let container = houseCache.get(url);
		if (!container) {
			try {
				const tLoad = performance.now();
				const parts = splitUrl(url);
				container = await BABYLON.SceneLoader.LoadAssetContainerAsync(parts.rootUrl, parts.fileName, scene);
				houseCache.set(url, container);
				console.log(`      ⏱️  Loaded ${parts.fileName} in ${(performance.now() - tLoad).toFixed(0)}ms`);
			} catch (e) {
				console.error("Failed to load house model:", url, e);
				// Fallback box
				const box = BABYLON.MeshBuilder.CreateBox(`house_fallback_${Math.random().toString(36).slice(2)}`, { size: 8 }, scene);
				box.position.copyFrom(position.clone().add(new BABYLON.Vector3(0, 4, 0)));
				return box;
			}
		}
		const inst = container.instantiateModelsToScene(name => `${name}_${Math.random().toString(36).slice(2)}`);
		const root = new BABYLON.TransformNode(`house_${Math.random().toString(36).slice(2)}`, scene);
		// Parent instantiated root nodes to our control root
		inst.rootNodes.forEach(n => { n.parent = root; });
		root.position.copyFrom(position);
		root.scaling.setAll(scale);
		return root;
	}
	
	// Materials for large apartment buildings
	const aptWallMat = new BABYLON.StandardMaterial("aptWallMat", scene);
	aptWallMat.diffuseColor = new BABYLON.Color3(0.7, 0.72, 0.75);
	aptWallMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
	const aptRoofMat = new BABYLON.StandardMaterial("aptRoofMat", scene);
	aptRoofMat.diffuseColor = new BABYLON.Color3(0.25, 0.25, 0.28);
	aptRoofMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
	
	// Place along each road; denser on minor roads, sparse on major
	for (const r of roads) {
		const perSide = r.isMajor ? 2 : 3;
		for (let s = -1; s <= 1; s += 2) {
			for (let i = 0; i < perSide; i++) {
				if (totalHouses >= maxHouses) break;
				const t = (i + 1) / (perSide + 1);
				const along = (t - 0.5) * r.length;
				const away = s * (r.halfW + 8 + rng() * 10); // keep off-road with margin
				
				// Convert local (along, across) to world
				const wx = r.center.x + (along * r.cos) + (-away * r.sin);
				const wz = r.center.z + (along * r.sin) + (away * r.cos);
				
				// Randomly decide between a house or an apartment (more houses on minors)
				const chooseApartment = r.isMajor && (rng() < 0.5);
				if (chooseApartment) {
					// Simple 6-floor box, flat roof
					const width = 12 + rng() * 12;
					const depth = 12 + rng() * 12;
					const floorH = 3.0;
					const height = floorH * 6;
					
					const body = BABYLON.MeshBuilder.CreateBox(`apt_${r.orientation}_${i}_${s}`, { width, depth, height }, scene);
					body.position.set(wx, height / 2, wz);
					body.material = aptWallMat;
					body.receiveShadows = true;
					
					// Flat roof slab
					const roof = BABYLON.MeshBuilder.CreateBox(`aptr_${r.orientation}_${i}_${s}`, { width: width * 1.02, depth: depth * 1.02, height: 0.4 }, scene);
					roof.position.set(wx, height + 0.2, wz);
					roof.material = aptRoofMat;
					continue;
				}
				
				// House placement
				const url = HOUSE_MODELS[Math.floor(rng() * HOUSE_MODELS.length)];
				const scale = 0.1 + rng() * 0.15; // Reduced scale: 0.1 to 0.25 (was 0.6 to 1.2)
				const pos = new BABYLON.Vector3(wx, 0, wz);
				// Create a lightweight placeholder immediately
				const phW = 8, phD = 8, phH = 5;
				const placeholder = BABYLON.MeshBuilder.CreateBox(`house_ph_${houses.length}`, { width: phW, depth: phD, height: phH }, scene);
				placeholder.position.set(pos.x, phH / 2, pos.z);
				placeholder.receiveShadows = true;
				
				const entry = {
					mesh: placeholder,
					roof: null,
					state: "normal",
					aabb: placeholder.getBoundingInfo().boundingBox
				};
				houses.push(entry);
				totalHouses++;
				
				// Load GLB asynchronously and replace the placeholder mesh when ready
				instantiateHouse(url, pos, scale).then((root) => {
					// Find a representative child mesh
					let meshRef = null;
					if (root && root.getChildren) {
						const children = root.getChildren();
						for (const c of children) {
							if (typeof c.getBoundingInfo === "function") { meshRef = c; break; }
						}
					}
					if (!meshRef) {
						// Fallback: keep placeholder if no child mesh found
						return;
					}
					// Replace entry.mesh with GLB mesh and dispose placeholder
					try {
						entry.mesh = meshRef;
						entry.aabb = meshRef.getBoundingInfo().boundingBox;
						placeholder.dispose();
					} catch (e) {
						// In case dispose fails, just hide placeholder
						placeholder.isVisible = false;
					}
				}).catch(() => {
					// Keep placeholder on failure
				});
			}
			if (totalHouses >= maxHouses) break;
		}
		if (totalHouses >= maxHouses) break;
	}
	
	return { houses };
}

function makeRoadMaterial(scene) {
	const mat = new BABYLON.StandardMaterial("roadMat", scene);
	mat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
	mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
	mat.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
	return mat;
}

function makeHouseMaterial(scene) {
	const mat = new BABYLON.StandardMaterial("houseMat", scene);
	mat.diffuseColor = new BABYLON.Color3(0.75, 0.72, 0.68);
	mat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
	return mat;
}

function makeRoofMaterial(scene) {
	const mat = new BABYLON.StandardMaterial("roofMat", scene);
	mat.diffuseColor = new BABYLON.Color3(0.55, 0.15, 0.1);
	mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
	return mat;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function seeded(s) {
	let x = s >>> 0;
	return function rnd() {
		// xorshift32
		x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
		return (x >>> 0) / 0xFFFFFFFF;
	};
}

// Road markings: yellow dashed centerline + white edge borders
function addRoadMarkings(scene, roadRec, extent) {
	const y = 0.06; // avoid z-fighting
	const yellow = new BABYLON.Color3(1.0, 0.9, 0.0);
	const white  = new BABYLON.Color3(1.0, 1.0, 1.0);
	
	if (roadRec.orientation === "vertical") {
		const x = roadRec.center.x;
		const z0 = -extent, z1 = extent;
		const mid = BABYLON.MeshBuilder.CreateDashedLines(
			`mark_c_v_${x}`,
			{ points: [ new BABYLON.Vector3(x, y, z0), new BABYLON.Vector3(x, y, z1) ], dashSize: 12, gapSize: 10, updatable: false },
			scene
		);
		mid.color = yellow;
		const left = BABYLON.MeshBuilder.CreateLines(
			`mark_l_v_${x}`,
			{ points: [ new BABYLON.Vector3(x - roadRec.halfW, y, z0), new BABYLON.Vector3(x - roadRec.halfW, y, z1) ] },
			scene
		);
		left.color = white;
		const right = BABYLON.MeshBuilder.CreateLines(
			`mark_r_v_${x}`,
			{ points: [ new BABYLON.Vector3(x + roadRec.halfW, y, z0), new BABYLON.Vector3(x + roadRec.halfW, y, z1) ] },
			scene
		);
		right.color = white;
	} else {
		const z = roadRec.center.z;
		const x0 = -extent, x1 = extent;
		const mid = BABYLON.MeshBuilder.CreateDashedLines(
			`mark_c_h_${z}`,
			{ points: [ new BABYLON.Vector3(x0, y, z), new BABYLON.Vector3(x1, y, z) ], dashSize: 12, gapSize: 10, updatable: false },
			scene
		);
		mid.color = yellow;
		const bot = BABYLON.MeshBuilder.CreateLines(
			`mark_l_h_${z}`,
			{ points: [ new BABYLON.Vector3(x0, y, z - roadRec.halfW), new BABYLON.Vector3(x1, y, z - roadRec.halfW) ] },
			scene
		);
		bot.color = white;
		const top = BABYLON.MeshBuilder.CreateLines(
			`mark_r_h_${z}`,
			{ points: [ new BABYLON.Vector3(x0, y, z + roadRec.halfW), new BABYLON.Vector3(x1, y, z + roadRec.halfW) ] },
			scene
		);
		top.color = white;
	}
}


