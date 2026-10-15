#!/usr/bin/env bash
set -euo pipefail

# /build/lila is a disposable BuildKit bind mount. Only /out is retained.
cd /build/lila
python3 cloudflare/build-prepare.py
# Foreground batch mode releases each JVM before the next component starts.
./lila.sh --server --batch --no-server -Depoll=true stage
test -x target/universal/stage/bin/lila
mkdir -p /out/lichess/app
cp -a target/universal/stage/. /out/lichess/app/
cp LICENSE COPYING.md /out/lichess/app/
cp bin/mongodb/indexes.js /out/lichess/indexes.js
rm -rf target project/target
find modules -type d -name target -prune -exec rm -rf {} +

# Fetch only the reviewed browser networks, without retaining another full checkout.
git init /build/browser-data
git -C /build/browser-data remote add origin https://github.com/lichess-org/lila.git
git -C /build/browser-data sparse-checkout set public/lifat/nnue
git -C /build/browser-data fetch --depth 1 origin "${LILA_REV}"
git -C /build/browser-data checkout --detach FETCH_HEAD
git -C /build/browser-data lfs pull --include='public/lifat/nnue/*'
mkdir -p public/lifat/nnue
cp -a /build/browser-data/public/lifat/nnue/. public/lifat/nnue/

pnpm install --frozen-lockfile
GIT_DIR=/build/browser-data/.git ./ui/build --no-install -p
test -f public/compiled/manifest.json
mkdir -p /out/lichess/app/public
cp -a public/. /out/lichess/app/public/
cp -a cloudflare/runtime /out/lichess/runtime
cp cloudflare/source-lock.json /out/lichess/source-lock.json
find . -type d -name node_modules -prune -exec rm -rf {} +
rm -rf /build/browser-data /root/.local/share/pnpm/store /root/.npm

git init /build/lila-ws
git -C /build/lila-ws remote add origin https://github.com/lichess-org/lila-ws.git
git -C /build/lila-ws fetch --depth 1 origin "${LILA_WS_REV}"
git -C /build/lila-ws checkout --detach FETCH_HEAD
cd /build/lila-ws
sbt --server --batch --no-server -J-Xms128m -J-Xmx2g -J-Xss2m stage
test -x target/universal/stage/bin/lila-ws
mkdir -p /out/lila-ws
cp -a target/universal/stage/. /out/lila-ws/
cp LICENSE /out/lila-ws/
cd /build/lila
rm -rf /build/lila-ws

git init /build/lila-fishnet
git -C /build/lila-fishnet remote add origin https://github.com/lichess-org/lila-fishnet.git
git -C /build/lila-fishnet fetch --depth 1 origin "${LILA_FISHNET_REV}"
git -C /build/lila-fishnet checkout --detach FETCH_HEAD
cd /build/lila-fishnet
sbt --server --batch --no-server -J-Xms128m -J-Xmx2g -J-Xss2m app/stage
test -x app/target/universal/stage/bin/lila-fishnet
mkdir -p /out/lila-fishnet
cp -a app/target/universal/stage/. /out/lila-fishnet/
cp LICENSE /out/lila-fishnet/
cd /build/lila
rm -rf /build/lila-fishnet

# Delete caches in the same RUN that created them, before Docker exports layers.
rm -rf /root/.cache /root/.sbt /root/.ivy2 /root/.local/share/pnpm /tmp/*
du -sh /out/*
df -h /out
