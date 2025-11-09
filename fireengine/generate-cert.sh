#!/bin/bash
# Generate self-signed certificate for local HTTPS development

mkdir -p certs

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/localhost-key.pem \
  -out certs/localhost-cert.pem \
  -days 365 \
  -subj "/C=US/ST=State/L=City/O=Dev/CN=localhost"

echo "✅ Self-signed certificate generated in ./certs/"
echo "   - localhost-cert.pem (certificate)"
echo "   - localhost-key.pem (private key)"
echo ""
echo "Note: Your browser will show a security warning because this is self-signed."
echo "Just click 'Advanced' → 'Proceed to localhost' to continue."

