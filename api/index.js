require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const helmet = require('helmet');
const MongoStore = require('connect-mongo');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// --- Gerenciador de Conexão ---
let isConnected = false;
async function connectMongo() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    try {
        console.log("Iniciando conexão com MongoDB...");
        await mongoose.connect(process.env.MONGO_URI);
        isConnected = true;
        console.log("MongoDB conectado com sucesso.");
    } catch (err) {
        console.error("Erro ao conectar ao MongoDB:", err);
        throw err;
    }
}

// --- Criação e Configuração do App Express ---
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { 
      secure: process.env.NODE_ENV === 'production', 
      httpOnly: true, 
      maxAge: 1000 * 60 * 60 * 24 
  }
}));

// Modelos
const Registro = require('../models/Registro.js');

// Middleware de Autenticação
const isAdmin = (req, res, next) => {
  if (req.session && req.session.userId && req.session.isAdmin) {
    return next();
  }
  res.status(403).json({ success: false, message: 'Acesso negado.' });
};


// --- ROTAS DA APLICAÇÃO ---

// Função wrapper para garantir a conexão em cada rota
const withDB = handler => async (req, res) => {
    try {
        await connectMongo();
        return handler(req, res);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro de conexão com o banco de dados.', error: error.message });
    }
};

app.post('/api/login', withDB(async (req, res) => {
    if (req.body.email === 'admin' && req.body.password === 'mayron2025') {
        req.session.userId = 'admin_user';
        req.session.isAdmin = true;
        return res.json({ success: true, user: { name: 'Admin GCM', email: 'admin@painel.com', isAdmin: true } });
    }
    res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
}));

app.get('/api/session', withDB(async (req, res) => {
    if (req.session && req.session.userId && req.session.isAdmin) {
        return res.json({ isAuthenticated: true, user: { name: 'Admin GCM', email: 'admin@painel.com', isAdmin: true } });
    }
    res.json({ isAuthenticated: false });
}));

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: 'Não foi possível fazer logout.' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/dashboard/summary', isAdmin, withDB(async (req, res) => {
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
      Registro.aggregate([ { $unwind: "$pontos" }, { $sort: { "pontos.entrada": -1 } }, { $limit: 5 }, { $project: { username: 1, 'ponto': '$pontos' } } ]),
      Registro.aggregate([ { $unwind: '$pontos' }, { $match: { 'pontos.entrada': { $gte: todayStart } } }, { $group: { _id: { $hour: { date: '$pontos.entrada', timezone: 'America/Sao_Paulo' } }, count: { $sum: 1 } } }, { $sort: { '_id': 1 } } ])
    ]);
    const hoursToday = hoursTodayResult.length > 0 ? (hoursTodayResult[0].totalMillis / 3600000).toFixed(1) : 0;
    const weeklyActivity = weeklyActivityResult.reduce((acc, day) => ({ ...acc, [day._id]: day.count }), {});
    const hourlyData = Array(24).fill(0);
    hourlyActivity.forEach(item => { hourlyData[item._id] = item.count; });
    res.json({ success: true, totalAgents: totalAgentsResult.length, pendingRegisters, closedToday, hoursToday, weeklyActivity, activityFeed, hourlyActivity: hourlyData });
}));


// ... (Adicione aqui suas outras rotas, envolvendo a lógica delas com `withDB(async (req, res) => { ... })`)


// Exporta o app Express para a Vercel
module.exports = app;