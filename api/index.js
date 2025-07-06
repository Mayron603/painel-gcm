const express = require('express');
const app = express();

// Rota para o frontend não quebrar ao tentar verificar a sessão
app.get('/api/session', (req, res) => {
  res.status(200).json({ isAuthenticated: false });
});

// Nossa rota de teste principal
app.get('/api/test', (req, res) => {
  res.status(200).json({ message: 'Olá, Mundo! A API mínima está funcionando!' });
});

module.exports = app;