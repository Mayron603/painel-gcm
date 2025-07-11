require('dotenv').config();

// Validação de variáveis de ambiente
if (!process.env.MONGO_URI) {
    console.error("\nERRO CRÍTICO: Variável de ambiente MONGO_URI não foi encontrada.");
}

// Importações de Pacotes
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Modelos do Banco de Dados
const Registro = require('../models/Registro.js');
const Member = require('../models/Member.js');

// --- LISTA DE MEMBROS PARA IGNORAR NA API ---
const IGNORED_MEMBER_IDS_API = [
    '459055303573635084',
    '425045919025725440',
    '511297052844621827'
];
// -------------------------------------------

// Conexão com MongoDB
const clientPromise = mongoose.connect(process.env.MONGO_URI)
  .then(connection => {
    console.log("LOG: Conexão com MongoDB estabelecida com sucesso.");
    return connection.connection.getClient();
  })
  .catch(err => {
    console.error("LOG: Erro fatal ao conectar ao MongoDB:", err);
    process.exit(1);
  });

// App Express
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));


app.get('/api/members', async (req, res) => {
    try {
        const members = await Member.find({ 
            discordUserId: { $nin: IGNORED_MEMBER_IDS_API } 
        }).sort({ username: 1 }).lean();
        
        res.json({ success: true, members });
    } catch (error) {
        console.error("Erro ao buscar membros:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar membros.' });
    }
});

const getWeekDateRange = (year, week) => {
    const d = new Date(year, 0, 1 + (week - 1) * 7);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { startDate: monday, endDate: sunday };
}

app.get('/api/ranking', async (req, res) => {
    const { period, year, month, week } = req.query;
    let startDate, endDate;
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    try {
        if (period === 'monthly') {
            const y = parseInt(year) || currentYear;
            const m = month ? parseInt(month) : currentMonth;
            startDate = new Date(y, m, 1);
            endDate = new Date(y, m + 1, 0);
            endDate.setHours(23, 59, 59, 999);
        } else { // weekly
            const y = parseInt(year) || currentYear;
            if (week) {
                ({ startDate, endDate } = getWeekDateRange(y, parseInt(week)));
            } else {
                const today = new Date();
                const dayOfWeek = today.getDay();
                const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
                startDate = new Date(today.setDate(diff));
                startDate.setHours(0,0,0,0);
                endDate = new Date(startDate);
                endDate.setDate(startDate.getDate() + 6);
                endDate.setHours(23, 59, 59, 999);
            }
        }

        const ranking = await Registro.aggregate([
            { $unwind: '$pontos' },
            { $match: { 
                'pontos.saida': { $ne: null },
                'pontos.entrada': { $gte: startDate, $lte: endDate }
            }},
            { $project: {
                userId: 1,
                username: 1,
                duration: { $subtract: ['$pontos.saida', '$pontos.entrada'] }
            }},
            { $group: {
                _id: { userId: '$userId', username: '$username' },
                totalDuration: { $sum: '$duration' }
            }},
            { $sort: { totalDuration: -1 }},
            { $limit: 20 },
            { $project: {
                _id: 0,
                userId: '$_id.userId',
                username: '$_id.username',
                totalDuration: 1
            }}
        ]);
        res.json({ success: true, ranking });
    } catch (error) {
        console.error(`Erro ao gerar ranking:`, error);
        res.status(500).json({ success: false, message: 'Erro ao gerar ranking.'});
    }
});

// ROTA DE REGISTROS ATUALIZADA PARA CALCULAR HORAS TOTAIS
app.get('/api/registros', async (req, res) => {
    const { userId, status, startDate, endDate } = req.query;
    let matchConditions = {};
    if (userId) matchConditions.userId = userId;

    try {
        const registros = await Registro.find(matchConditions).lean();

        let totalDuration = 0;
        const finalRegistros = [];

        registros.forEach(reg => {
            const filteredPontos = reg.pontos.filter(ponto => {
                let isValid = true;
                if (status === 'pending' && ponto.saida !== null) isValid = false;
                if (status === 'completed' && ponto.saida === null) isValid = false;
                
                // Converte as datas de filtro apenas uma vez
                const startFilterDate = startDate ? new Date(startDate) : null;
                const endFilterDate = endDate ? new Date(endDate) : null;
                if(endFilterDate) endFilterDate.setHours(23, 59, 59, 999);

                const pontoEntrada = new Date(ponto.entrada);

                if (startFilterDate && pontoEntrada < startFilterDate) isValid = false;
                if (endFilterDate && pontoEntrada > endFilterDate) isValid = false;
                
                return isValid;
            });

            if (filteredPontos.length > 0) {
                // Calcula a duração total apenas para os pontos que passaram pelo filtro
                filteredPontos.forEach(p => {
                    if (p.saida) {
                        totalDuration += (new Date(p.saida) - new Date(p.entrada));
                    }
                });
                finalRegistros.push({ ...reg, pontos: filteredPontos });
            }
        });

        res.json({ success: true, registros: finalRegistros, totalDuration });
    } catch (error) {
        console.error("Erro ao buscar registros:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar registros.' });
    }
});


app.get('/api/unique-users', async (req, res) => {
    const users = await Registro.aggregate([
        { $group: { _id: { userId: "$userId", username: "$username" } } },
        { $sort: { "_id.username": 1 } },
        { $project: { userId: "$_id.userId", username: "$_id.username", _id: 0 } }
    ]);
    res.json({ success: true, users });
});

app.get('/api/dashboard/summary', async (req, res) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [
        totalAgentsResult, pendingRegisters, closedToday, hoursTodayResult, weeklyActivityResult, activityFeed, hourlyActivity
    ] = await Promise.all([
        Registro.distinct('userId'),
        Registro.countDocuments({ 'pontos.saida': null }),
        Registro.countDocuments({ 'pontos.saida': { $gte: todayStart } }),
        Registro.aggregate([
            { $unwind: '$pontos' },
            { $match: { 'pontos.saida': { $gte: todayStart } } },
            { $group: { _id: null, totalMillis: { $sum: { $subtract: ['$pontos.saida', '$pontos.entrada'] } } } }
        ]),
        Registro.aggregate([
            { $unwind: '$pontos' },
            { $match: { 'pontos.entrada': { $gte: new Date(new Date().setDate(new Date().getDate() - 7)) } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$pontos.entrada" } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]),
        Registro.aggregate([
            { $unwind: "$pontos" },
            { $sort: { "pontos.entrada": -1 } },
            { $limit: 5 },
            { $project: { username: 1, 'ponto': '$pontos' } }
        ]),
        Registro.aggregate([
            { $unwind: '$pontos' },
            { $match: { 'pontos.entrada': { $gte: todayStart } } },
            { $group: { _id: { $hour: { date: '$pontos.entrada', timezone: 'America/Sao_Paulo' } }, count: { $sum: 1 } } },
            { $sort: { '_id': 1 } }
        ])
    ]);
    const hoursToday = hoursTodayResult.length > 0 ? (hoursTodayResult[0].totalMillis / 3600000).toFixed(1) : 0;
    const weeklyActivity = weeklyActivityResult.reduce((acc, day) => ({ ...acc, [day._id]: day.count }), {});
    const hourlyData = Array(24).fill(0);
    hourlyActivity.forEach(item => { hourlyData[item._id] = item.count; });
    res.json({
        success: true,
        totalAgents: totalAgentsResult.length,
        pendingRegisters,
        closedToday,
        hoursToday,
        weeklyActivity,
        activityFeed,
        hourlyActivity: hourlyData
    });
});

app.get('/api/alerts', async (req, res) => {
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
});

app.get('/api/registros/export', async (req, res) => {
    const { format, userId, status, startDate, endDate } = req.query;
    let matchConditions = {};
    if (userId) matchConditions.userId = userId;
    const registros = await Registro.find(matchConditions).lean();
    const allPontos = registros.flatMap(reg => reg.pontos.map(p => ({ ...p, username: reg.username })));
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
    }).sort((a, b) => new Date(b.entrada) - new Date(a.entrada));

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
        return workbook.xlsx.write(res).then(() => res.status(200).end());
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
                `Usuário: ${p.username}\nEntrada: ${new Date(p.entrada).toLocaleString('pt-BR')}\n` +
                `Saída: ${p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'N/A'}\nDuração: ${duracao}\n`,
                { lineGap: 4 }
            );
            doc.lineCap('round').moveTo(doc.x, doc.y).lineTo(565, doc.y).strokeColor("#dddddd").stroke();
            doc.moveDown();
        });
        doc.end();
    } else {
        res.status(400).send('Formato inválido.');
    }
});

app.put('/api/registros/:pontoId', async (req, res) => {
    const { pontoId } = req.params;
    const { entrada, saida } = req.body;
    if (!entrada || !saida) return res.status(400).json({ success: false, message: "Datas de entrada e saída são obrigatórias." });
    const result = await Registro.updateOne(
        { "pontos._id": pontoId },
        { $set: { "pontos.$.entrada": new Date(entrada), "pontos.$.saida": new Date(saida) } }
    );
    if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: "Registro não encontrado ou dados iguais." });
    res.json({ success: true, message: "Registro atualizado com sucesso!" });
});

app.delete('/api/registros/:pontoId', async (req, res) => {
    const { pontoId } = req.params;
    const result = await Registro.updateOne(
        { "pontos._id": pontoId },
        { $pull: { pontos: { _id: pontoId } } }
    );
    if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: "Registro não encontrado." });
    res.json({ success: true, message: "Registro excluído com sucesso!" });
});

// Handler final (para Vercel)
const handler = async (req, res) => {
  try {
    await clientPromise;
    return app(req, res);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro crítico na inicialização da API.', error: error.message });
  }
};

module.exports = handler;