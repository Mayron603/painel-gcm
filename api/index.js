require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const Registro = require('../models/Registro.js');

// --- Gerenciador de Conexão ---
let cachedDb = null;
async function connectMongo() {
  if (cachedDb && mongoose.connection.readyState === 1) return;
  try {
    cachedDb = await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB conectado.");
  } catch (err) {
    console.error("Erro ao conectar ao MongoDB:", err);
    throw err;
  }
}

// --- Middlewares ---
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// --- Wrapper de Rota ---
const withDB = handler => async (req, res) => {
    try {
        await connectMongo();
        return await handler(req, res);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Erro de conexão com o banco de dados.', error: error.message });
    }
};

// --- Rota Principal (Dashboard) ---
app.get('/api/dashboard/summary', withDB(async (req, res) => {
    const totalAgentsResult = await Registro.distinct('userId');
    // Adicione outras lógicas se necessário
    res.json({ success: true, totalAgents: totalAgentsResult.length });
}));

// Exporta o app para a Vercel
module.exports = app;