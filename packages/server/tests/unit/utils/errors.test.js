import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '../../../src/utils/errors.js';

describe('AppError', () => {
  it('has correct defaults', () => {
    const err = new AppError('boom');
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.name).toBe('AppError');
  });

  it('accepts custom statusCode and code', () => {
    const err = new AppError('custom', 418, 'TEAPOT');
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
  });

  it('is an instance of Error', () => {
    expect(new AppError('x')).toBeInstanceOf(Error);
  });
});

describe('NotFoundError', () => {
  it('has correct defaults', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.name).toBe('NotFoundError');
  });

  it('accepts a custom resource name', () => {
    expect(new NotFoundError('Session').message).toBe('Session not found');
  });

  it('extends AppError', () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });
});

describe('UnauthorizedError', () => {
  it('has correct defaults', () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe('Unauthorized');
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.name).toBe('UnauthorizedError');
  });

  it('accepts a custom message', () => {
    expect(new UnauthorizedError('bad token').message).toBe('bad token');
  });
});

describe('ForbiddenError', () => {
  it('has correct defaults', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.name).toBe('ForbiddenError');
  });
});

describe('ValidationError', () => {
  it('has correct defaults', () => {
    const err = new ValidationError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
  });
});

describe('ConflictError', () => {
  it('has correct defaults', () => {
    const err = new ConflictError('duplicate');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.name).toBe('ConflictError');
  });
});

describe('instanceof chain', () => {
  it('all subclasses are instanceof AppError and Error', () => {
    const errors = [
      new NotFoundError(),
      new UnauthorizedError(),
      new ForbiddenError(),
      new ValidationError('x'),
      new ConflictError('x'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
