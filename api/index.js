require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const Registro = require('../models/Registro.js');

// Gerenciador de Conexão
let cachedDb = null;
async function connectMongo() {
  if (cachedDb) return;
  try {
    cachedDb = await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB conectado para esta instância.");
  } catch (err) {
    console.error("Erro ao conectar ao MongoDB:", err);
    throw err;
  }
}

// Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// Rota Única para o Dashboard
app.get('/api/dashboard/summary', async (req, res) => {
    try {
        await connectMongo();
        const totalAgentsResult = await Registro.distinct('userId');
        // Você pode adicionar mais dados aqui se precisar
        res.status(200).json({ success: true, totalAgents: totalAgentsResult.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao carregar dados do dashboard' });
    }
});

// Exporta o app para a Vercel
module.exports = app;