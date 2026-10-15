import {mkdir, writeFile} from 'node:fs/promises';

export function validateEnvironment(env) {
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
      || origin.username || origin.password || origin.port || origin.hostname.endsWith('.example.com')) {
    throw new Error('PUBLIC_ORIGIN must be the public HTTPS origin.');
  }
  for (const key of ['PLAY_SECRET', 'USER_PASSWORD_SECRET', 'CONTAINER_CONTROL_TOKEN', 'FISHNET_KEY']) {
    if (typeof env[key] !== 'string' || env[key].length < 32) throw new Error(`Configure a strong ${key}.`);
  }
  const aes = Buffer.from(env.USER_PASSWORD_SECRET, 'base64');
  if (aes.length !== 32 || aes.toString('base64') !== env.USER_PASSWORD_SECRET) {
    throw new Error('USER_PASSWORD_SECRET must be the Base64 encoding of 32 random bytes.');
  }
  return origin;
}

export function buildConfiguration(env) {
  const origin = validateEnvironment(env);
  const q = JSON.stringify;
  const app = `include required(classpath("base.conf"))
include required(classpath("version.conf"))
mongodb.uri = "mongodb://localhost:27017/lichess?replicaSet=rs0&appName=lila"
mongodb.yolo.uri = \${mongodb.uri}
study.mongodb.uri = \${mongodb.uri}
puzzle.mongodb.uri = \${mongodb.uri}
insight.mongodb.uri = \${mongodb.uri}
net.domain = ${q(origin.host)}
net.prodDomain = ${q(origin.host)}
net.site.name = "Chess"
net.base_url = ${q(origin.origin)}
net.asset.domain = ${q(origin.host)}
net.asset.base_url = ${q(origin.origin)}
net.socket.domains = [${q(origin.host)}]
net.socket.alts = []
net.crawlable = false
net.ratelimit = true
net.email = ""
play.http.secret.key = ${q(env.PLAY_SECRET)}
play.http.session.secure = true
play.http.session.httpOnly = true
play.server.http.address = "127.0.0.1"
play.server.http.port = 9663
play.server.dir = "/opt/lichess/app"
play.mode = "prod"
http.port = 9663
user.password.bpass.secret = ${q(env.USER_PASSWORD_SECRET)}
security.password_reset.secret = ${q(env.PLAY_SECRET + ':password-reset')}
security.email_confirm.enabled = false
security.email_confirm.secret = ${q(env.PLAY_SECRET + ':email-confirm')}
security.email_change.secret = ${q(env.PLAY_SECRET + ':email-change')}
security.login_token.secret = ${q(env.PLAY_SECRET + ':login-token')}
security.turnstile_cookie.secret = ${q(env.PLAY_SECRET + ':turnstile')}
storm.secret = ${q(env.PLAY_SECRET + ':storm')}
api.token = ${q(env.PLAY_SECRET + ':api')}
oauth.signedClients.mobile.secrets = []
oauth.signedClients.takex3.secrets = []
redis.uri = "redis://127.0.0.1:6379"
fishnet.offline_mode = false
search.enabled = false
mailer.primary.mock = true
mailer.secondary.mock = true
turnstile.enabled = false
kamon.enabled = false
api.influx_event.endpoint = "http://127.0.0.1:9/disabled"
explorer.endpoint = ${q(origin.origin + '/explorer')}
explorer.internal_endpoint = "http://127.0.0.1:9/disabled"
explorer.tablebase_endpoint = "http://127.0.0.1:9/disabled"
fide.players.url = "http://127.0.0.1:9/disabled"
fide.ratings.url = "http://127.0.0.1:9/disabled"
video.sheet.url = "http://127.0.0.1:9/disabled"
push.web.url = "http://127.0.0.1:9/disabled"
push.firebase.mobile.url = "http://127.0.0.1:9/disabled"
push.firebase.mobile.jsonPath = ""
pekko.actor.default-dispatcher.fork-join-executor.parallelism-max = 8
mongodb.mongo-async-driver.pekko.actor.default-dispatcher.fork-join-executor.parallelism-max = 8
`;
  const socket = `include required(classpath("application.conf"))
http.port = 9664
http.use-nginx-forwarded-ip = yes
mongo.uri = "mongodb://localhost:27017/lichess?replicaSet=rs0&appName=lila-ws"
study.mongo.uri = \${mongo.uri}
yolo.mongo.uri = \${mongo.uri}
redis.uri = "redis://127.0.0.1:6379"
csrf.origin = ${q(origin.origin)}
csrf.extraOrigins = []
cookie.name = "lila2"
storm.secret = ${q(env.PLAY_SECRET + ':storm')}
oauth.secrets = []
kamon.enabled = false
kamon.influxdb.hostname = ""
`;
  const nginx = `daemon off;
worker_processes 1;
pid /run/lichess/nginx.pid;
error_log stderr warn;
events {worker_connections 2048;}
http {
  include /etc/nginx/mime.types;
  types {application/javascript mjs;}
  default_type application/octet-stream;
  access_log off;
  sendfile on;
  map $http_upgrade $connection_upgrade {default upgrade; '' close;}
  map $http_upgrade $application_port {default 9663; ~*websocket 9664;}
  server {
    listen 127.0.0.1:8082;
    server_name _;
    client_max_body_size 10m;
    location ^~ /_cf {return 404;}
    location ^~ /fishnet {return 404;}
    location ~ "^/assets/(?:_[a-zA-Z0-9]{6}/)?(.+)$" {
      alias /opt/lichess/app/public/$1;
      add_header Cache-Control "public, max-age=3600";
      add_header Cross-Origin-Resource-Policy same-origin always;
      add_header Cross-Origin-Opener-Policy same-origin always;
      add_header Cross-Origin-Embedder-Policy require-corp always;
    }
    location = /favicon.ico {alias /opt/lichess/app/public/favicon.ico;}
    location / {
      proxy_pass http://127.0.0.1:$application_port;
      proxy_http_version 1.1;
      proxy_set_header Host ${origin.host};
      proxy_set_header X-Forwarded-Host ${origin.host};
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $http_x_forwarded_for;
      proxy_set_header X-Real-IP $http_x_real_ip;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_hide_header Cross-Origin-Opener-Policy;
      proxy_hide_header Cross-Origin-Embedder-Policy;
      proxy_buffering off;
      proxy_read_timeout 3600s;
      add_header Cross-Origin-Opener-Policy same-origin always;
      add_header Cross-Origin-Embedder-Policy require-corp always;
    }
  }
}
`;
  const logger = `<configuration debug="false">
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%date %-5level %logger{36} - %msg%n%ex{30}</pattern>
    </encoder>
  </appender>
  <root level="INFO">
    <appender-ref ref="STDOUT" />
  </root>
</configuration>
`;
  return {app, socket, nginx, logger};
}

export async function writeConfiguration(env) {
  const config = buildConfiguration(env);
  await mkdir('/run/lichess', {recursive: true});
  for (const [name, contents] of [['site.conf', config.app], ['socket.conf', config.socket], ['nginx.conf', config.nginx], ['logger.xml', config.logger]]) {
    await writeFile(`/run/lichess/${name}`, contents, {mode: 0o600});
  }
  return config;
}
