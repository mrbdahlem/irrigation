module.exports = {
  apps: [{
    name: "irrigation",
    script: "index.js",
    interpreter: "/usr/bin/node",
    instances: 1,
    autorestart: true
  }]
}
