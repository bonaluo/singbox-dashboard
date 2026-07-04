ARG NODE_IMAGE=node:22-alpine
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG NEXT_PUBLIC_API=http://localhost:9092
FROM ${NODE_IMAGE} AS builder
ARG NPM_REGISTRY
ARG NEXT_PUBLIC_API
ENV NEXT_PUBLIC_API=${NEXT_PUBLIC_API}
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
EXPOSE 9000
CMD ["node", "server.js"]
