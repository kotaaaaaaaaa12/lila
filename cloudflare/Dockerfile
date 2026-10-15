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
    && npm install -g pnpm@12.9.0
ARG SBT_VERSION=2.0.10
RUN curl --fail --location --retry 5 \
    "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" -o /tmp/sbt.tgz \
    && tar -xzf /tmp/sbt.tgz -C /opt && rm /tmp/sbt.tgz
ENV PATH="/opt/sbt/bin:${PATH}"

WORKDIR /build/lila
COPY . .
RUN python3 cloudflare/build-prepare.py
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    ./lila.sh -Depoll=true stage
# Hydrate browser Stockfish networks only. Optional voice and Maia models are not needed for core play.
ARG LILA_REV=2b8dbf48b958cbec6207818abc9c08b1d949b184
RUN git init /build/browser-data \
    && git -C /build/browser-data remote add origin https://github.com/lichess-org/lila.git \
    && git -C /build/browser-data fetch --depth 1 origin ${LILA_REV} \
    && git -C /build/browser-data checkout --detach FETCH_HEAD \
    && git -C /build/browser-data lfs pull --include='public/lifat/nnue/*' \
    && cp -a /build/browser-data/public/lifat/nnue/. /build/lila/public/lifat/nnue/


RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile && ./ui/build --no-install -p
RUN test -f public/compiled/manifest.json \
    && test -x target/universal/stage/bin/lila

ARG LILA_WS_REV=89b1e88eba547d2602746e83f3c80765149ff23a
RUN git init /build/lila-ws \
    && git -C /build/lila-ws remote add origin https://github.com/lichess-org/lila-ws.git \
    && git -C /build/lila-ws fetch --depth 1 origin ${LILA_WS_REV} \
    && git -C /build/lila-ws checkout --detach FETCH_HEAD
WORKDIR /build/lila-ws
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt -J-Xms128m -J-Xmx2g -J-Xss2m stage

ARG LILA_FISHNET_REV=bce5d1fddbad02174eb9f7bb9b68e6c57c5cadef
RUN git init /build/lila-fishnet \
    && git -C /build/lila-fishnet remote add origin https://github.com/lichess-org/lila-fishnet.git \
    && git -C /build/lila-fishnet fetch --depth 1 origin ${LILA_FISHNET_REV} \
    && git -C /build/lila-fishnet checkout --detach FETCH_HEAD
WORKDIR /build/lila-fishnet
RUN --mount=type=cache,target=/root/.cache/coursier \
    --mount=type=cache,target=/root/.sbt \
    sbt -J-Xms128m -J-Xmx2g -J-Xss2m app/stage


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
COPY --from=builder /build/lila/target/universal/stage/ /opt/lichess/app/
COPY --from=builder /build/lila/public/ /opt/lichess/app/public/
COPY --from=builder /build/lila/LICENSE /build/lila/COPYING.md /opt/lichess/app/
COPY --from=builder /build/lila/bin/mongodb/indexes.js /opt/lichess/indexes.js
COPY --from=builder /build/lila-ws/target/universal/stage/ /opt/lila-ws/
COPY --from=builder /build/lila-ws/LICENSE /opt/lila-ws/
COPY --from=builder /build/lila-fishnet/app/target/universal/stage/ /opt/lila-fishnet/
COPY --from=builder /build/lila-fishnet/LICENSE /opt/lila-fishnet/
COPY --from=fishnet /fishnet /opt/fishnet/fishnet
COPY cloudflare/runtime/ /opt/lichess/runtime/
COPY cloudflare/source-lock.json /opt/lichess/source-lock.json
RUN mkdir -p /data/mongo /data/redis /data/fishnet-play /data/fishnet-analysis /run/lichess \
    && /opt/fishnet/fishnet --version
WORKDIR /opt/lichess
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "--max-old-space-size=128", "/opt/lichess/runtime/control.mjs"]
