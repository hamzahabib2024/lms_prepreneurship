import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body/query against a shared Zod schema.
 *
 * SEC-VAL-001: input is validated server-side against an allow-list of
 * expected type, format, length and range. Client-side validation is a
 * usability feature only and is never trusted.
 *
 * SEC-VAL-012: schemas use `.strict()` where mass assignment matters, so an
 * unexpected field (role, marks, registrationNo) is rejected rather than
 * quietly bound.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    // Throws ZodError, which AllExceptionsFilter turns into a 422 listing
    // every failing field at once (NFR-ERR-005).
    return this.schema.parse(value);
  }
}

/** Sugar: `@Body(zodBody(loginSchema)) dto: LoginInput` */
export const zodBody = (schema: ZodSchema): ZodValidationPipe => new ZodValidationPipe(schema);
