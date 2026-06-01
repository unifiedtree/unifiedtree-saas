#!/usr/bin/env bash
# Generates RSA-2048 key pair for JWT signing.
# Run once per environment. Never commit private.pem.

set -euo pipefail

KEYS_DIR="hrms-app/src/main/resources/keys"
mkdir -p "$KEYS_DIR"

echo "Generating RSA-2048 key pair..."

# Generate private key (PKCS8 format required by Java KeyFactory)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/private.pem"

# Extract public key
openssl rsa -pubout -in "$KEYS_DIR/private.pem" -out "$KEYS_DIR/public.pem"

chmod 600 "$KEYS_DIR/private.pem"
chmod 644 "$KEYS_DIR/public.pem"

echo "Keys written to $KEYS_DIR/"
echo "  private.pem — KEEP SECRET. Listed in .gitignore."
echo "  public.pem  — Safe to commit."
