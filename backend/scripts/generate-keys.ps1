# Generates RSA-2048 key pair for JWT signing (Windows version).
# Requires OpenSSL on PATH. Install via: winget install ShiningLight.OpenSSL
# Never commit private.pem.

$KeysDir = "hrms-app\src\main\resources\keys"
New-Item -ItemType Directory -Force -Path $KeysDir | Out-Null

Write-Host "Generating RSA-2048 key pair..."

# Generate private key in PKCS8 format (required by Java KeyFactory)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KeysDir\private.pem"

# Extract public key
openssl rsa -pubout -in "$KeysDir\private.pem" -out "$KeysDir\public.pem"

Write-Host "Keys written to $KeysDir\"
Write-Host "  private.pem -- KEEP SECRET. Listed in .gitignore."
Write-Host "  public.pem  -- Safe to commit."
