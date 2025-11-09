// Flames manager: renders a single animated GIF billboard over a target house
export function createFlameManager(scene) {
	const plane = BABYLON.MeshBuilder.CreatePlane("flameBillboard", { size: 3 }, scene);
	plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
	plane.isVisible = false;
	plane.isPickable = false;
	plane.alwaysSelectAsActiveMesh = true;
	
	// GUI on mesh to support animated GIF
	const ui = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane, 256, 256, false);
	const img = new BABYLON.GUI.Image("flameImg", "/flames.gif");
	img.stretch = BABYLON.GUI.Image.STRETCH_UNIFORM;
	ui.addControl(img);
	
	function showOn(house) {
		if (!house || !house.mesh) { hide(); return; }
		const bbox = house.mesh.getBoundingInfo().boundingBox;
		const center = bbox.centerWorld.clone();
		const topY = bbox.maximumWorld.y;
		plane.position.set(center.x, topY + 1.5, center.z);
		plane.isVisible = true;
	}
	function hide() {
		plane.isVisible = false;
	}
	return { showOn, hide };
}


