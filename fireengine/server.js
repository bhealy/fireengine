"use strict";

const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Basic security headers
app.disable("x-powered-by");
app.use((req, res, next) => {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "SAMEORIGIN");
	res.setHeader("Referrer-Policy", "no-referrer");
	next();
});

// Static hosting for client
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, {
	etag: false,
	maxAge: 0,
	index: "index.html",
}));

app.get("/healthz", (_req, res) => {
	res.status(200).json({ ok: true });
});

app.get("*", (_req, res) => {
	res.sendFile(path.join(publicDir, "index.html"));
});

// Try to use HTTPS if certificates exist, fallback to HTTP
const certPath = path.join(__dirname, "certs", "localhost-cert.pem");
const keyPath = path.join(__dirname, "certs", "localhost-key.pem");

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
	const httpsOptions = {
		key: fs.readFileSync(keyPath),
		cert: fs.readFileSync(certPath)
	};
	
	https.createServer(httpsOptions, app).listen(PORT, () => {
		console.log(`[fireengine] 🔒 HTTPS Server listening on https://localhost:${PORT}`);
		console.log(`            Camera access will work without permission issues!`);
	});
} else {
	app.listen(PORT, () => {
		console.log(`[fireengine] ⚠️  HTTP Server listening on http://localhost:${PORT}`);
		console.log(`            For HTTPS (recommended for camera access), run:`);
		console.log(`            chmod +x generate-cert.sh && ./generate-cert.sh`);
	});
}


