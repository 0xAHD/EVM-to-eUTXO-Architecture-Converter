import Fastify from 'fastify';
import cors from '@fastify/cors';
import { runConversion, EXAMPLES } from '@evm-eutxo/converter';
import type { ConvertInput, RenderedOutput } from '@evm-eutxo/converter';

export function buildApp() {
  const app = Fastify({ logger: false });

  app.register(cors, { origin: true });

  /* ── Health check ── */
  app.get('/health', async () => ({ status: 'ok' }));

  /* ── Get built-in examples ── */
  app.get('/examples', async () => EXAMPLES);

  /* ── Main conversion endpoint ── */
  app.post<{ Body: ConvertInput }>('/convert', async (request, reply) => {
    const body = request.body;

    // Validate: at least one input must be present
    if (!body.solidity && !body.abi && !body.description) {
      return reply.status(400).send({
        error: 'At least one of solidity, abi, or description must be provided.',
      });
    }

    // Default options
    const options = {
      target: 'cardano-eutxo' as const,
      detailLevel: body.options?.detailLevel ?? 'medium',
      assumptions: {
        useNFTState: body.options?.assumptions?.useNFTState ?? true,
        useIndexers: body.options?.assumptions?.useIndexers ?? true,
      },
    };

    try {
      const result: RenderedOutput = runConversion({
        solidity: body.solidity,
        abi: body.abi,
        description: body.description,
        options,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: `Conversion failed: ${message}` });
    }
  });

  return app;
}

/* ── Start server when run directly ── */
const isMain = process.argv[1] && (
  process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js')
);

if (isMain) {
  const app = buildApp();
  const port = parseInt(process.env.PORT ?? '3001', 10);

  app.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`API server listening at ${address}`);
  });
}
