// Online-play backend: game-engine node + lobby matchmaker + uWS gateway.
//
// These were built and verified as M0-M5 but never started in production, so
// every seek sat on "Waiting for a match" forever with nothing to match it.
// See PROJECT_MASTER/plans/online-play-realtime-architecture.md
//
//   sudo -u ubuntu pm2 start /home/ubuntu/chessguru/v2/ecosystem.play.config.cjs
//   sudo -u ubuntu pm2 save
//
// Gateway is on 18080 because :8080 is already taken by another node process.
// nginx proxies chessguru.cc/ws -> 127.0.0.1:18080/ws.

const CWD = "/home/ubuntu/chessguru/v2";
const REDIS_URL = "redis://127.0.0.1:6379";
const MONGO_URI = "mongodb://127.0.0.1:27017/chessguru";

module.exports = {
  apps: [
    {
      name: "play-engine",
      cwd: CWD,
      script: "apps/game-engine/src/main.ts",
      interpreter: `${CWD}/apps/game-engine/node_modules/.bin/tsx`,
      env: { NODE_ID: "e1", ENGINE_PORT: "9101", REDIS_URL, MONGO_URI },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      time: true,
    },
    {
      name: "play-lobby",
      cwd: CWD,
      script: "apps/lobby/src/main.ts",
      interpreter: `${CWD}/apps/lobby/node_modules/.bin/tsx`,
      env: { REDIS_URL, MONGO_URI },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      time: true,
    },
    {
      name: "play-gateway",
      cwd: CWD,
      script: "apps/ws/src/main.ts",
      interpreter: `${CWD}/apps/ws/node_modules/.bin/tsx`,
      // MONGO_URI: identity is the API session cookie looked up in `sessions`
      // (apps/ws/src/identity.ts). Never set PLAY_TRUST_TOKENS here.
      env: { WS_PORT: "18080", GW_ID: "gw1", REDIS_URL, MONGO_URI },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      time: true,
    },
    {
      name: "play-bot",
      cwd: CWD,
      script: "apps/bot-player/src/main.ts",
      interpreter: `${CWD}/apps/bot-player/node_modules/.bin/tsx`,
      // Talks to the gateway on loopback as an ordinary client, so it goes through
      // exactly the same seek/match/move path a browser does.
      env: {
        REDIS_URL,
        MONGO_URI,
        BOT_WS_URL: "ws://127.0.0.1:18080/ws",
        MAIA_BIN: "/home/dreamworld/opt/maia3/.venv/bin/maia3-uci",
        MAIA_MODEL: "maia3-5m",
        // Weights were fetched under dreamworld; ubuntu gets its own copy and must never
        // try to reach Hugging Face at move time.
        HF_HOME: "/home/ubuntu/.cache/huggingface",
        HF_HUB_OFFLINE: "1",
        OMP_NUM_THREADS: "2",
        MKL_NUM_THREADS: "2",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      time: true,
    },
  ],
};
