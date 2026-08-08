import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { ActorService } from "./actor.service";
import { ActorContextMiddleware } from "./actor-context.middleware";

/**
 * SEC-AUT-002/005 — RS256 with the algorithm pinned server-side.
 *
 * `algorithms: ["RS256"]` on verification is what makes an `alg: none` or
 * downgraded token fail; without it, a verifier can be tricked into honouring
 * whatever the token's own header claims.
 */
/**
 * Reads a key, searching upward from the working directory.
 *
 * The API runs from apps/api under `npm run dev` but from the repository root
 * under `npm start`, while the keys live at the root in both cases. Resolving
 * against cwd alone works from one and fails from the other, so the lookup
 * walks up until it finds the file.
 */
function readKey(path: string): string {
  const attempted: string[] = [];
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth++) {
    const candidate = resolve(dir, path);
    attempted.push(candidate);
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
  }

  throw new Error(
    `Could not read the JWT signing key "${path}". Run \`npm run keys:generate\` ` +
      `from the repository root before starting the API.\nLooked in:\n  ` +
      attempted.join("\n  "),
  );
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        privateKey: readKey(config.get<string>("JWT_PRIVATE_KEY_PATH", "./keys/jwt-private.pem")),
        publicKey: readKey(config.get<string>("JWT_PUBLIC_KEY_PATH", "./keys/jwt-public.pem")),
        signOptions: {
          algorithm: "RS256",
          expiresIn: config.get<string>("JWT_ACCESS_TTL", "15m"),
          issuer: config.get<string>("JWT_ISSUER", "lms.local"),
          audience: config.get<string>("JWT_AUDIENCE", "lms-api"),
        },
        verifyOptions: {
          algorithms: ["RS256"],
          issuer: config.get<string>("JWT_ISSUER", "lms.local"),
          audience: config.get<string>("JWT_AUDIENCE", "lms-api"),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ActorService, ActorContextMiddleware],
  exports: [AuthService, ActorService, JwtModule],
})
export class AuthModule {}
