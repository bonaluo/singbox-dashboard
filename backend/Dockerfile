ARG GO_IMAGE=golang:1.25-alpine
FROM ${GO_IMAGE} AS builder
ARG GIT_COMMIT=unknown
ARG VERSION=unknown
WORKDIR /app
COPY go.mod main.go ./
COPY config/ config/
COPY handlers/ handlers/
COPY models/ models/
COPY services/ services/
RUN CGO_ENABLED=0 go build -ldflags="-X 'singbox-dashboard/config.GitCommit=${GIT_COMMIT}' -X 'singbox-dashboard/config.Version=${VERSION}'" -o singbox-dashboard .

FROM ghcr.io/sagernet/sing-box:latest
RUN apk add --no-cache curl
COPY --from=builder /app/singbox-dashboard /usr/local/bin/
ENTRYPOINT []
EXPOSE 9092
CMD ["singbox-dashboard"]
