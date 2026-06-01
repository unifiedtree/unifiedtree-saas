const fs = require('fs');
const localtunnel = require(process.env.APPDATA + '\\npm\\node_modules\\localtunnel');
(async () => {
  const tunnel = await localtunnel({ port: 8080, local_host: 'localhost' });
  fs.writeFileSync('backend-tunnel-url.txt', tunnel.url, 'utf8');
  console.log(tunnel.url);
  tunnel.on('close', () => console.error('backend tunnel closed'));
  setInterval(() => {}, 1000);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
