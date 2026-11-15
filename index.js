const express = require('express');
const path = require('path');
const Unblocker = require('unblocker');

const app = express();
const PORT = 3000;

const unblocker = new Unblocker({
  prefix: '/proxy/',
});

app.use(unblocker);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Prism running at http://localhost:${PORT}`);
});

server.on('upgrade', unblocker.onUpgrade);
