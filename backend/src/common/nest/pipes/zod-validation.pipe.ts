import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';
import { ValidationError } from '../../errors';

// DTO classes keep only static schema metadata. Properties are declared with `declare`
// so Nest can pass the parsed Zod result through without creating runtime fields.
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Custom parameter decorators own their parsing/validation. In particular,
    // @JsonBody returns undefined for multipart requests so polymorphic routes
    // can hand the request to Fastify's multipart parser.
    if (metadata.type === 'custom') return value;

    const schema = dtoSchema(metadata.metatype);
    if (!schema) return value;
    try {
      return schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError('请求参数验证失败', { issues: err.issues });
      }
      throw err;
    }
  }
}

function dtoSchema(metatype: unknown): ZodType | undefined {
  if (!hasSchemaProperty(metatype)) return undefined;
  return metatype.schema instanceof ZodType ? metatype.schema : undefined;
}

function hasSchemaProperty(value: unknown): value is { schema?: unknown } {
  return (
    (typeof value === 'function' || (typeof value === 'object' && value !== null)) &&
    'schema' in value
  );
}
