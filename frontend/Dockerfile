FROM node:22-alpine
WORKDIR /app
# 宿主机构建产物直接打入镜像（build.sh 已执行 npm run build）
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
EXPOSE 9000
CMD ["node", "server.js"]
