import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
function readKey(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    throw new Error(
      `Could not read JWT key at "${path}". Run \`npm run keys:generate\` from the ` +
        `repository root before starting the API.`,
    );
  }
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
