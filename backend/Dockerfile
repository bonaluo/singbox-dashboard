FROM docker.1ms.run/library/golang:1.25-alpine AS builder
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG GIT_COMMIT=unknown
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY
WORKDIR /app
COPY go.mod main.go ./
COPY config/ config/
COPY handlers/ handlers/
COPY models/ models/
COPY services/ services/
RUN CGO_ENABLED=0 go build -ldflags="-X 'singbox-dashboard/config.GitCommit=${GIT_COMMIT}'" -o singbox-dashboard .

FROM ghcr.io/sagernet/sing-box:latest
RUN apk add --no-cache curl
COPY --from=builder /app/singbox-dashboard /usr/local/bin/
ENTRYPOINT []
EXPOSE 9092
CMD ["singbox-dashboard"]
