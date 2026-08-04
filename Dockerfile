# Production image for Vultr (Caddy reverse-proxy at calclaim.jayhasty.com).
# better-sqlite3 needs a native compile; tsx runs TypeScript at start (same as Railway).
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci \
  && npm cache clean --force

COPY corpus ./corpus
COPY public ./public
COPY src ./src
COPY tsconfig.json ./
COPY PRIVACY.md ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
