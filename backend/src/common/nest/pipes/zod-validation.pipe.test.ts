import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { ValidationError } from '../../errors';
import { ZodValidationPipe } from './zod-validation.pipe';

class ExampleDto {
  static readonly schema = z.object({ name: z.string() });
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();

  it('validates regular DTO parameters', () => {
    expect(
      pipe.transform({ name: 'Slate' }, { type: 'body', metatype: ExampleDto, data: undefined })
    ).toEqual({ name: 'Slate' });

    expect(() =>
      pipe.transform(undefined, { type: 'body', metatype: ExampleDto, data: undefined })
    ).toThrow(ValidationError);
  });

  it('leaves custom decorator values to the decorator validation', () => {
    expect(
      pipe.transform(undefined, {
        type: 'custom',
        metatype: ExampleDto,
        data: undefined,
      })
    ).toBeUndefined();
  });
});
