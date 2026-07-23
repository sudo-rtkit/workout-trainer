import { buildServer } from './server.js';

const app = buildServer();

app.listen({ port: 3000, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
