import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './server.js';
import { ERC20_EXAMPLE, ESCROW_EXAMPLE } from '@evm-eutxo/converter';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /examples', () => {
  it('returns built-in examples', async () => {
    const res = await app.inject({ method: 'GET', url: '/examples' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.erc20).toBeDefined();
    expect(body.escrow).toBeDefined();
    expect(body.lending).toBeDefined();
  });
});

describe('POST /convert', () => {
  it('returns 400 when no input provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/convert',
      payload: { options: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('converts ERC20 Solidity input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/convert',
      payload: {
        solidity: ERC20_EXAMPLE,
        options: {
          target: 'cardano-eutxo',
          detailLevel: 'medium',
          assumptions: { useNFTState: true, useIndexers: true },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mappingMarkdown).toContain('ERC20');
    expect(body.flowsMarkdown).toContain('transfer()');
    expect(body.diagramMarkdown).toContain('Validator');
    expect(body.checklistMarkdown).toContain('Checklist');
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.meta.detectedPatterns).toContain('ERC20');
    expect(body.meta.confidence).toBeGreaterThan(0);
  });

  it('converts Escrow Solidity input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/convert',
      payload: {
        solidity: ESCROW_EXAMPLE,
        options: {
          target: 'cardano-eutxo',
          detailLevel: 'medium',
          assumptions: { useNFTState: true, useIndexers: true },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.detectedPatterns).toContain('Escrow');
    expect(body.flowsMarkdown).toContain('deposit()');
    expect(body.flowsMarkdown).toContain('release()');
    expect(body.flowsMarkdown).toContain('refund()');
  });

  it('converts text description input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/convert',
      payload: {
        description: 'An ERC20 token with escrow features',
        options: {
          target: 'cardano-eutxo',
          detailLevel: 'low',
          assumptions: { useNFTState: false, useIndexers: false },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.detectedPatterns).toContain('ERC20');
    expect(body.meta.detectedPatterns).toContain('Escrow');
  });

  it('uses default options when partial options provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/convert',
      payload: {
        solidity: ERC20_EXAMPLE,
        options: {},
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.detectedPatterns).toContain('ERC20');
  });
});
