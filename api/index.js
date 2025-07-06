require('dotenv').config();

// Validação de variáveis de ambiente essenciais
if (!process.env.MONGO_URI || !process.env.SESSION_SECRET) {
    console.error("\nERRO CRÍTICO: Variáveis de ambiente MONGO_URI ou SESSION_SECRET não foram encontradas.");
}

// Importações de Pacotes
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

// Modelos do Banco de Dados
const Registro = require('../models/Registro.js');

// --- Gerenciador de Conexão com o MongoDB ---
let isConnected = false;
async function connectMongo() {
    if (isConnected && mongoose.connection.readyState === 1) {
        console.log('LOG: Usando conexão de DB em cache.');
        return;
    }
    try {
        console.log('LOG: Criando nova conexão com o banco de dados...');
        await mongoose.connect(process.env.MONGO_URI);
        isConnected = true;
        console.log("LOG: MongoDB conectado com sucesso.");
    } catch (err) {
        console.error("LOG: Erro ao conectar ao MongoDB:", err);
        throw err;
    }
}

// --- Configurações e Middlewares ---
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false })); // Simplificado para deploy
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

// --- Middleware de Autenticação ---
const isAdmin = (req, res, next) => {
  if (req.session && req.session.userId && req.session.isAdmin) {
    return next();
  }
  res.status(403).json({ success: false, message: 'Acesso negado.' });
};

// --- ROTAS DA APLICAÇÃO ---

app.post('/api/login', async (req, res) => {
    try {
        await connectMongo();
        if (req.body.email === 'admin' && req.body.password === 'mayron2025') {
            req.session.userId = 'admin_user';
            req.session.isAdmin = true;
            return res.json({ success: true, user: { name: 'Admin GCM', email: 'admin@painel.com', isAdmin: true } });
        }
        res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro no servidor durante o login.', error: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: 'Não foi possível fazer logout.' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/session', async (req, res) => {
    try {
        await connectMongo();
        if (req.session && req.session.userId && req.session.isAdmin) {
            return res.json({ isAuthenticated: true, user: { name: 'Admin GCM', email: 'admin@painel.com', isAdmin: true } });
        }
        res.json({ isAuthenticated: false });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro de servidor na sessão.', error: error.message });
    }
});

app.get('/api/registros', isAdmin, async (req, res) => {
  try {
    await connectMongo();
    const { userId, status, startDate, endDate } = req.query;
    let matchConditions = {};
    if (userId) matchConditions.userId = userId;
    const registros = await Registro.find(matchConditions).lean();
    const filteredRegistros = registros.map(reg => {
        reg.pontos = reg.pontos.filter(ponto => {
            let isValid = true;
            if (status === 'pending' && ponto.saida !== null) isValid = false;
            if (status === 'completed' && ponto.saida === null) isValid = false;
            if (startDate && new Date(ponto.entrada) < new Date(startDate)) isValid = false;
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                if (new Date(ponto.entrada) > end) isValid = false;
            }
            return isValid;
        });
        return reg;
    }).filter(reg => reg.pontos.length > 0);
    res.json({ success: true, registros: filteredRegistros });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar registros.', error: error.message });
  }
});

app.get('/api/unique-users', isAdmin, async (req, res) => {
    try {
        await connectMongo();
        const users = await Registro.aggregate([
            { $group: { _id: { userId: "$userId", username: "$username" } } },
            { $sort: { "_id.username": 1 } },
            { $project: { userId: "$_id.userId", username: "$_id.username", _id: 0 } }
        ]);
        res.json({ success: true, users });
    } catch(e) {
        res.status(500).json({ success: false, message: 'Erro ao buscar usuários únicos.', error: e.message });
    }
});

app.get('/api/dashboard/summary', isAdmin, async (req, res) => {
  try {
    await connectMongo();
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
  } catch (error) {
      res.status(500).json({ success: false, message: 'Erro ao calcular estatísticas.', error: error.message });
  }
});

app.get('/api/alerts', isAdmin, async (req, res) => {
    try {
        await connectMongo();
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const alerts = await Registro.find({
            'pontos.saida': null,
            'pontos.entrada': { $lt: twelveHoursAgo }
        }, 'username pontos.entrada').lean();
        const longRunningPontos = alerts.map(reg => {
            const pontoInfo = reg.pontos.find(p => p.saida === null && new Date(p.entrada) < twelveHoursAgo);
            return pontoInfo ? { username: reg.username, entrada: pontoInfo.entrada } : null;
        }).filter(Boolean);
        res.json({ success: true, alerts: longRunningPontos });
    } catch(e) {
        res.status(500).json({ success: false, message: 'Erro ao buscar alertas.', error: e.message });
    }
});

app.get('/api/registros/export', isAdmin, async (req, res) => {
    try {
        await connectMongo();
        const { format, userId, status, startDate, endDate } = req.query;
        let matchConditions = {};
        if (userId) matchConditions.userId = userId;
        const registros = await Registro.find(matchConditions).lean();
        const allPontos = registros.flatMap(reg => reg.pontos.map(p => ({...p, username: reg.username })));
        const filteredPontos = allPontos.filter(ponto => {
            let isValid = true;
            if (status === 'pending' && ponto.saida !== null) isValid = false;
            if (status === 'completed' && ponto.saida === null) isValid = false;
            if (startDate && new Date(ponto.entrada) < new Date(startDate)) isValid = false;
            if (endDate) {
                 const end = new Date(endDate);
                 end.setHours(23, 59, 59, 999);
                 if (new Date(ponto.entrada) > end) isValid = false;
            }
            return isValid;
        }).sort((a,b) => new Date(b.entrada) - new Date(a.entrada));

        if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Relatório');
            worksheet.columns = [
                { header: 'Usuário', key: 'username', width: 30 },
                { header: 'Entrada', key: 'entrada', width: 25 },
                { header: 'Saída', key: 'saida', width: 25 },
                { header: 'Duração (h)', key: 'duracao', width: 15 }
            ];
            filteredPontos.forEach(p => {
                const duracao = p.saida ? ((new Date(p.saida) - new Date(p.entrada)) / 36e5).toFixed(2) : 'N/A';
                worksheet.addRow({
                    username: p.username,
                    entrada: new Date(p.entrada).toLocaleString('pt-BR'),
                    saida: p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'Em serviço',
                    duracao: duracao
                });
            });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="relatorio.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } else if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="relatorio.pdf"');
            doc.pipe(res);
            doc.fontSize(18).text('Relatório de Pontos', { align: 'center' });
            doc.moveDown(2);
            filteredPontos.forEach(p => {
                const duracao = p.saida ? ((new Date(p.saida) - new Date(p.entrada)) / 36e5).toFixed(2) + 'h' : 'Em serviço';
                doc.fontSize(10).text(
                    `Usuário: ${p.username}\n` +
                    `Entrada: ${new Date(p.entrada).toLocaleString('pt-BR')}\n` +
                    `Saída: ${p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'N/A'}\n` +
                    `Duração: ${duracao}\n`,
                    { lineGap: 4 }
                );
                doc.lineCap('round').moveTo(doc.x, doc.y).lineTo(565, doc.y).strokeColor("#dddddd").stroke();
                doc.moveDown();
            });
            doc.end();
        } else {
            res.status(400).send('Formato inválido.');
        }
    } catch(e) {
        res.status(500).send('Erro ao gerar relatório.');
    }
});

app.post('/api/registros/force-logout/:pontoId', isAdmin, async (req, res) => {
    try {
        await connectMongo();
        const { pontoId } = req.params;
        const registro = await Registro.findOne({ "pontos._id": pontoId });
        if (!registro) return res.status(404).json({ success: false, message: "Registro não encontrado." });
        const ponto = registro.pontos.id(pontoId);
        if (ponto.saida) return res.status(400).json({ success: false, message: "Este ponto já está encerrado." });
        ponto.saida = new Date();
        await registro.save();
        res.json({ success: true, message: "Ponto encerrado com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao forçar saída.", error: error.message });
    }
});

app.put('/api/registros/:pontoId', isAdmin, async (req, res) => {
    try {
        await connectMongo();
        const { pontoId } = req.params;
        const { entrada, saida } = req.body;
        if (!entrada || !saida) return res.status(400).json({ success: false, message: "Datas de entrada e saída são obrigatórias." });
        const result = await Registro.updateOne(
            { "pontos._id": pontoId },
            { $set: { "pontos.$.entrada": new Date(entrada), "pontos.$.saida": new Date(saida) } }
        );
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: "Registro não encontrado ou dados iguais." });
        res.json({ success: true, message: "Registro atualizado com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao atualizar registro.", error: error.message });
    }
});

app.delete('/api/registros/:pontoId', isAdmin, async (req, res) => {
    try {
        await connectMongo();
        const { pontoId } = req.params;
        const result = await Registro.updateOne(
            { "pontos._id": pontoId },
            { $pull: { pontos: { _id: pontoId } } }
        );
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: "Registro não encontrado." });
        res.json({ success: true, message: "Registro excluído com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao excluir registro.", error: error.message });
    }
});


// Exporta o app Express completo para a Vercel
module.exports = app;