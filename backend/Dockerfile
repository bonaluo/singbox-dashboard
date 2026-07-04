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

ARG SINGBOX_IMAGE=ghcr.io/sagernet/sing-box:v1.13.12
FROM ${SINGBOX_IMAGE}
# alpine 换源到阿里云（国内 docker 默认走国际源极慢）
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
 && apk add --no-cache curl
COPY --from=builder /app/singbox-dashboard /usr/local/bin/
ENTRYPOINT []
EXPOSE 9092
CMD ["singbox-dashboard"]
