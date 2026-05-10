FROM node:20-alpine

WORKDIR /app

# Install dependencies (lock file for reproducible builds)
COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

# Copy source. Ownership is set to the unprivileged `node` user so the runtime
# process can read its own files even after USER node below.
COPY --chown=node:node src/ ./src/

EXPOSE 3001

# Drop root before the process actually runs. Container escapes that gain root
# inside the container would otherwise gain it on the host volume too.
USER node

# /api/health is implemented in backend/src/index.js. wget ships with alpine
# so we don't need an extra package; --spider makes it a HEAD-style probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "src/index.js"]
