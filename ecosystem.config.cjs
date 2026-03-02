module.exports = {
  apps: [{
    name: "irrigation",
    script: "index.js",
    cwd: __dirname,
    env_file: `${__dirname}/.env`,
    interpreter: "/usr/bin/node",
    instances: 1,
    autorestart: true
  }]
}
