require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();

// --- Conexão com MongoDB ---
// Ele vai pegar a MONGO_URI das suas variáveis de ambiente na Vercel
mongoose.connect(process.env.MONGO_URI)
 .then(() => console.log('LOG: Conexão com MongoDB iniciada com sucesso.'))
 .catch(err => console.error('LOG: Erro ao iniciar conexão com MongoDB:', err));


// --- Rota de Teste de Conexão ---
app.get('/api/test', async (req, res) => {
  try {
    // Verifica se a conexão está ativa fazendo um comando 'ping'
    await mongoose.connection.db.admin().ping();
    res.status(200).json({ success: true, message: 'SUCESSO! A conexão com o MongoDB está funcionando!' });
  } catch (error) {
    // Se o ping falhar, retorna um erro detalhado
    res.status(500).json({ 
      success: false, 
      message: 'FALHA: A API não conseguiu se comunicar com o MongoDB.',
      error: error.message 
    });
  }
});

// Rota de sessão para o frontend não quebrar
app.get('/api/session', (req, res) => {
  res.status(200).json({ isAuthenticated: false });
});

module.exports = app;