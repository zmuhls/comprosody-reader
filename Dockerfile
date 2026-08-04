# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS app-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && ./node_modules/.bin/tsc --project server/tsconfig.production.json


FROM node:22-bookworm-slim AS node-runtime-deps

WORKDIR /app

# The root manifest also contains browser-only packages. Derive a locked,
# server-only manifest so build tools and the React bundle do not enter the
# runtime image.
COPY package.json package-lock.json ./
RUN node -e "const fs=require('node:fs'); const pkg=require('./package.json'); const names=new Set(['cors','dotenv','express']); pkg.dependencies=Object.fromEntries(Object.entries(pkg.dependencies).filter(([name])=>names.has(name))); delete pkg.devDependencies; fs.writeFileSync('package.json', JSON.stringify(pkg,null,2)+'\n');" \
    && npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force


FROM node:22-bookworm-slim AS python-build

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/cadence-venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      python3 \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/cadence-venv \
    && pip install --no-cache-dir --requirement /tmp/requirements.txt


FROM node:22-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/cadence-venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      ffmpeg \
      libgomp1 \
      python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=python-build /opt/cadence-venv /opt/cadence-venv
COPY --from=node-runtime-deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=node-runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=app-build --chown=node:node /app/dist ./dist
COPY --from=app-build --chown=node:node /app/server-dist ./server-dist
COPY --from=app-build --chown=node:node /app/server/scripts ./server-dist/scripts

# Railway supplies PORT. HOST must be non-loopback in a container; the server
# refuses that bind unless COMPROSODY_API_KEY is also configured at runtime.
ENV NODE_ENV=production \
    HOST=:: \
    PORT=3001

EXPOSE 3001

USER node

CMD ["node", "server-dist/index.js"]
