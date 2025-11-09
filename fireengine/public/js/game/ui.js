// UI helpers: star celebration
export function showStar(scene, targetNode, durationSec = 10) {
	const mat = new BABYLON.StandardMaterial("starMat", scene);
	mat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.2);
	mat.diffuseColor = new BABYLON.Color3(1, 0.85, 0.1);
	mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

	const star = createStarMesh(scene);
	star.material = mat;
	star.scaling.set(1.2, 1.2, 0.4);
	star.parent = targetNode;
	star.position = new BABYLON.Vector3(0, 3.5, 0);

	// Flash animation
	const anim = new BABYLON.Animation("starFlash", "material.emissiveColor", 30, BABYLON.Animation.ANIMATIONTYPE_COLOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
	const keys = [];
	for (let i = 0; i <= 30; i++) {
		const t = i / 30;
		const k = 0.6 + 0.4 * Math.sin(t * Math.PI * 2);
		keys.push({ frame: i, value: new BABYLON.Color3(1 * k, 0.9 * k, 0.2 * k) });
	}
	anim.setKeys(keys);
	star.animations = [anim];
	scene.beginAnimation(star, 0, 30, true);

	return new Promise((resolve) => {
		setTimeout(() => {
			star.dispose();
			resolve();
		}, durationSec * 1000);
	});
}

function createStarMesh(scene) {
	// 5-pointed star 2D path, then extrude
	const R = 1.2, r = 0.5;
	const pts = [];
	for (let i = 0; i < 10; i++) {
		const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
		const radius = i % 2 === 0 ? R : r;
		pts.push(new BABYLON.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
	}
	pts.push(pts[0].clone());
	const shape = pts;
	const path = [new BABYLON.Vector3(0, 0, -0.15), new BABYLON.Vector3(0, 0, 0.15)];
	const star = BABYLON.MeshBuilder.ExtrudeShape("starMesh", { shape, path, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
	return star;
}


