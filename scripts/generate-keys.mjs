/**
 * Generates the RSA key pair used to sign access tokens.
 *
 * SEC-AUT-005 requires a strong signing algorithm with the algorithm pinned
 * server-side. We use RS256, so the API signs with the private key and any
 * verifier needs only the public key.
 *
 * Usage:  npm run keys:generate
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyDir = join(root, "keys");

if (existsSync(join(keyDir, "jwt-private.pem"))) {
  console.error(
    "Refusing to overwrite: keys/jwt-private.pem already exists.\n" +
      "Rotating the signing key invalidates every issued token. Delete the\n" +
      "existing keys deliberately if that is what you intend (SEC-CRY-011).",
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, "jwt-private.pem"), privateKey, { mode: 0o600 });
writeFileSync(join(keyDir, "jwt-public.pem"), publicKey, { mode: 0o644 });

console.log("Wrote keys/jwt-private.pem and keys/jwt-public.pem");
console.log("keys/ is git-ignored. Never commit these (SEC-CRY-008).");
