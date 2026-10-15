# syntax=docker/dockerfile:1
FROM node:24.20.0-bookworm-slim AS node
FROM niklasf/fishnet:2.12.0 AS fishnet

FROM eclipse-temurin:21-jdk-noble AS builder
ENV CI=true DEBIAN_FRONTEND=noninteractive GIT_LFS_SKIP_SMUDGE=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git git-lfs python3 unzip libatomic1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && npm install -g pnpm@12.9.0 \
    && npm cache clean --force
ARG SBT_VERSION=2.0.10
RUN curl --fail --location --retry 5 \
    "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" -o /tmp/sbt.tgz \
    && tar -xzf /tmp/sbt.tgz -C /opt && rm /tmp/sbt.tgz
ENV PATH="/opt/sbt/bin:${PATH}"

ARG LILA_REV=2b8dbf48b958cbec6207818abc9c08b1d949b184
ARG LILA_WS_REV=89b1e88eba547d2602746e83f3c80765149ff23a
ARG LILA_FISHNET_REV=bce5d1fddbad02174eb9f7bb9b68e6c57c5cadef
WORKDIR /build/lila
# Source writes are disposable; the build script retains only deployable files in /out.
# Keep all builds and cleanup in one RUN so deleted intermediates never become image layers.
RUN --mount=type=bind,source=.,target=/build/lila,rw \
    bash cloudflare/build-image.sh

FROM eclipse-temurin:21-jdk-noble AS runtime
ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production LOCAL_ACCOUNTS=true
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg nginx redis-server libatomic1 libstdc++6 \
    && curl --fail --location --retry 5 https://www.mongodb.org/static/pgp/server-8.0.asc \
      | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg \
    && printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse' \
      > /etc/apt/sources.list.d/mongodb-org-8.0.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      mongodb-org-server mongodb-mongosh mongodb-database-tools \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=builder /out/ /opt/
COPY --from=fishnet /fishnet /opt/fishnet/fishnet
RUN mkdir -p /data/mongo /data/redis /data/fishnet-play /data/fishnet-analysis /run/lichess \
    && /opt/fishnet/fishnet --version
WORKDIR /opt/lichess
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "--max-old-space-size=128", "/opt/lichess/runtime/control.mjs"]
