FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# Install dependencies
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/converter/package.json packages/converter/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY . .

# Build
RUN pnpm build

# ── Production stage ──
FROM node:20-slim AS production
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

COPY --from=base /app .

EXPOSE 3001 5173

CMD ["pnpm", "dev"]
