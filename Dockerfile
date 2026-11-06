# syntax=docker/dockerfile:1
# 卫戍协议：盟约 · production image (server + static client). Docs: docs/operations/DEPLOY.md「Docker」.
#
# Code: GPL-3.0-or-later (LICENSE). Game art/audio is © Hypergryph / Yostar, not covered by the GPL, non-commercial use
# only (NOTICE.md). This fork includes local-client art; two ways to add the remaining downloaded art:
#   A) download it while building (needs internet during the build):
#        docker build -t stronghold-protocol --build-arg FETCH_ASSETS=1 .
#   B) build without it and mount the host's copy (prepared with `node tools/setup.mjs` on the host):
#        docker build -t stronghold-protocol .
#        docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
#          -v "$PWD/public/assets:/app/public/assets:ro" stronghold-protocol
#      (public/fonts, data/assets.json, data/local-assets.json and data/local-fx.json are copied from the build context when present)
# Without any art the game still runs with placeholder visuals.
#
# Run:  see docs/operations/DEPLOY.md for CDN, probe announcement directory and persistent state mounts.
# Env:  PORT (3000), HOST (0.0.0.0), SP_COMBAT (client|server), SP_VERIFY (off|sample|all), TRUST_PROXY (auto|1|0), DEBUG

# Pinned to the 2026-10-21 security release (CVE-2026-111497, bundled Brotli decoder out-of-bounds write).
# A floating `node:24-alpine` would drift with upstream rebuilds, so the fix is not guaranteed to survive a rebuild.
ARG NODE_IMAGE=node:24.22.1-alpine

# ---- 1. production dependencies (cached while package*.json are unchanged) -------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the postinstall (tools/vendor.mjs) runs in the next stage, once the sources are there
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---- 2. vendor libs + optional art download ---------------------------------------------------------
FROM deps AS build
ARG FETCH_ASSETS=0
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY vite.config.js ./vite.config.js
COPY shared ./shared
# Canonical offline name moderation, shared with the isolated auth image. No auth UI/secrets/game data.
COPY deploy/stardust/auth/name-policy.mjs \
     deploy/stardust/auth/name-dictionary.mjs \
     deploy/stardust/auth/name-sensitive-dictionary.mjs \
     deploy/stardust/auth/name-filter-vendor.mjs \
     deploy/stardust/auth/name-filter-node.mjs \
     deploy/stardust/auth/NAME-DICTIONARY-LICENSE.txt \
     deploy/stardust/auth/NAME-FILTER-LICENSE.txt \
     deploy/stardust/auth/NAME-CATEGORIES-LICENSE.txt \
     deploy/stardust/auth/NAME-POLITICAL-LICENSE.txt ./deploy/stardust/auth/
# Players' feedback board (server/index.js mounts it on /feedback): the module and its page only, no tests or env samples.
# public/ must stay a directory: the board resolves its page from <module dir>/public, so a multi-source COPY would flatten it.
COPY deploy/stardust/feedback/policy.mjs \
     deploy/stardust/feedback/store.mjs \
     deploy/stardust/feedback/server.mjs ./deploy/stardust/feedback/
COPY deploy/stardust/feedback/public ./deploy/stardust/feedback/public
COPY server ./server
COPY tools ./tools
COPY data ./data
COPY public ./public
COPY plugins ./plugin-resources
COPY schemas ./schemas
COPY test/helpers/battleHarness.js ./test/helpers/battleHarness.js
COPY docs/PLUGIN*.md docs/plugin-catalog.example.json ./docs/
COPY docs/research ./docs/research
RUN node tools/vendor.mjs \
 && npm run build \
 && if [ "$FETCH_ASSETS" = "1" ]; then \
      node tools/fetch-assets.mjs || echo "WARNING: art download incomplete; the image falls back to placeholder art"; \
    fi \
 && rm -rf .cache
# Maintainer 2026-10-23 (§35.66): this image is a release. Drop the external-AI / LLM files and write
# server/release-without-llm so the server ignores those settings. The #673 bots stay. Do not import
# llmGate.js here (it would load the host before the files are gone) or tools/package.mjs.
RUN node --input-type=module -e "import { omitLlmFromRelease } from './server/match/llmRelease.js'; omitLlmFromRelease('/app');"

# ---- 2b. the Vite bundle of the UI layer (fork; vite.config.js — the dev dependencies stay in this stage) ----------
FROM ${NODE_IMAGE} AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY vite.config.js ./
COPY shared ./shared
COPY --from=build /app/public ./public
RUN npx vite build && rm -rf node_modules

# ---- 3. runtime ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE}
# SP_CLIENT=build: / is the bundle's page (public/build/, server/http/static.js)
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SP_CLIENT=build \
    SP_PLUGIN_RESOURCES=/app/plugin-resources
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/deploy/stardust/auth ./deploy/stardust/auth
COPY --from=build /app/deploy/stardust/feedback ./deploy/stardust/feedback
COPY --from=build /app/server ./server
# Published art fingerprints are needed even when the CDN serves all binary assets.
COPY .assets-manifest.json ./.assets-manifest.json
COPY --from=build /app/data ./data
COPY --from=build /app/public ./public
COPY --from=client /app/public/build ./public/build
# the Spine and atlas parsers the plugin packer and the plugin studio use (server/plugins/pack.js, server/studio/)
COPY --from=build /app/tools/assets ./tools/assets
COPY --from=build /app/tools/plugin.mjs ./tools/plugin.mjs
COPY --from=build /app/test/helpers/battleHarness.js ./test/helpers/battleHarness.js
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/docs/PLUGIN*.md /app/docs/plugin-catalog.example.json ./docs/
# Root-owned templates and author guides remain visible when /app/plugins is a bind mount or named volume.
COPY --from=build /app/plugin-resources ./plugin-resources
RUN mkdir -p /app/plugins && chown node:node /app/plugins
# research tables: read by server/sim/nodeData.js as a fallback
COPY --from=build /app/docs/research ./docs/research

RUN mkdir -p /app/.state && chown node:node /app/.state
ENV SP_STATE_FILE=/app/.state/server.state.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/index.js"]
