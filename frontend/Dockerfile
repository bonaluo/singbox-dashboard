ARG NODE_IMAGE=node:22-alpine
ARG NPM_REGISTRY=https://registry.npmjs.org
FROM ${NODE_IMAGE} AS builder
ARG NPM_REGISTRY
WORKDIR /app
COPY package*.json ./
RUN npm install --registry ${NPM_REGISTRY}
COPY . .
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
