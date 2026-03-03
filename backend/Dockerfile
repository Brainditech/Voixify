FROM node:20-alpine

WORKDIR /app

# Install dependencies (lock file for reproducible builds)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
