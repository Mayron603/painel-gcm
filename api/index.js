require('dotenv').config();

if (!process.env.MONGO_URI || !process.env.SESSION_SECRET) {
    console.error("\nERRO CRÍTICO: Variáveis de ambiente MONGO_URI ou SESSION_SECRET não foram encontradas.");
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const MongoStore = require('connect-mongo');

const app = express();

const Registro = require('../models/Registro.js');

// --- Configuração de CORS ---
const corsOptions = {
  origin: process.env.CORS_ORIGIN,
  credentials: true,
};
app.use(cors(corsOptions));

// --- Configurações de Segurança ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net/npm/"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      },
    },
  })
);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));

// --- Middlewares ---
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI
  }),
  cookie: { 
      secure: process.env.NODE_ENV === 'production', 
      httpOnly: true, 
      maxAge: 1000 * 60 * 60 * 24 
  }
}));

// --- Conexão com MongoDB ---
mongoose.connect(process.env.MONGO_URI)
 .then(() => console.log('✅ Conexão da API com o MongoDB estabelecida!'))
 .catch(err => console.error('Erro na conexão com MongoDB:', err));

// --- Middleware de Autenticação ---
const isAdmin = (req, res, next) => {
  if (req.session && req.session.userId && req.session.isAdmin) {
    return next();
  }
  res.status(403).json({ success: false, message: 'Acesso negado.' });
};

// --- ROTAS DA APLICAÇÃO ---

app.post('/api/login', async (req, res) => {
    if (req.body.email === 'admin' && req.body.password === 'mayron2025') {
        req.session.userId = 'admin_user';
        req.session.isAdmin = true;
        return res.json({ success: true, user: { name: 'Admin GCM', email: 'admin@painel.com', isAdmin: true } });
    }
    res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
});

app.get('/api/dashboard/summary', isAdmin, async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [
        totalAgentsResult, pendingRegisters, closedToday, hoursTodayResult, weeklyActivityResult, activityFeed, hourlyActivity
    ] = await Promise.all([
      Registro.distinct('userId'),
      Registro.countDocuments({ 'pontos.saida': null }),
      Registro.countDocuments({ 'pontos.saida': { $gte: todayStart } }),
      Registro.aggregate([ { $unwind: '$pontos' }, { $match: { 'pontos.saida': { $gte: todayStart } } }, { $group: { _id: null, totalMillis: { $sum: { $subtract: ['$pontos.saida', '$pontos.entrada'] } } } } ]),
      Registro.aggregate([ { $unwind: '$pontos' }, { $match: { 'pontos.entrada': { $gte: new Date(new Date().setDate(new Date().getDate() - 7)) } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$pontos.entrada" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } } ]),
      // --- CORREÇÃO APLICADA AQUI ---
      // A ordenação correta é por 'pontos.entrada' depois do $unwind
      Registro.aggregate([ { $unwind: "$pontos" }, { $sort: { "pontos.entrada": -1 } }, { $limit: 5 }, { $project: { username: 1, 'ponto': '$pontos' } } ]),
      Registro.aggregate([ { $unwind: '$pontos' }, { $match: { 'pontos.entrada': { $gte: todayStart } } }, { $group: { _id: { $hour: { date: '$pontos.entrada', timezone: 'America/Sao_Paulo' } }, count: { $sum: 1 } } }, { $sort: { '_id': 1 } } ])
    ]);
    const hoursToday = hoursTodayResult.length > 0 ? (hoursTodayResult[0].totalMillis / 3600000).toFixed(1) : 0;
    const weeklyActivity = weeklyActivityResult.reduce((acc, day) => ({ ...acc, [day._id]: day.count }), {});
    const hourlyData = Array(24).fill(0);
    hourlyActivity.forEach(item => { hourlyData[item._id] = item.count; });
    res.json({ success: true, totalAgents: totalAgentsResult.length, pendingRegisters, closedToday, hoursToday, weeklyActivity, activityFeed, hourlyActivity: hourlyData });
  } catch (error) {
      console.error("Erro em /api/dashboard/summary:", error);
      res.status(500).json({ success: false, message: 'Erro ao calcular estatísticas.' });
  }
});

// Adicione aqui todas as suas outras rotas...
// (/api/registros, /api/unique-users, /api/alerts, etc.)

// Exporta o app para a Vercel
module.exports = app;