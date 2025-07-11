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

// HIERARQUIA DE CARGOS (Do maior para o menor)
const roleHierarchy = [
    'Inspetor Superintendente',
    'Inspetor de Agrupamento',
    'Inspetor de Divisão',
    'Inspetor',
    'Subinspetor',
    'Classe Distinta',
    'Classe Especial',
    'Agente de 1ª Classe',
    'Agente de 2ª Classe',
    'Agente de 3ª Classe',
    'Estágio'
];

// Função auxiliar para obter o nível hierárquico de um membro (VERSÃO CORRIGIDA)
const getRoleLevel = (member) => {
    let level = Infinity; 
    const memberRoles = member.roles.map(r => r.name);

    // Itera sobre os cargos do membro
    for (const memberRole of memberRoles) {
        // Itera sobre a hierarquia para ver se o nome do cargo do membro contém um dos nomes da hierarquia
        for (let i = 0; i < roleHierarchy.length; i++) {
            const hierarchyRole = roleHierarchy[i];
            if (memberRole.includes(hierarchyRole)) {
                // Se encontrar uma correspondência, e se for um nível mais alto (índice menor), atualiza
                if (i < level) {
                    level = i;
                }
            }
        }
    }
    return level;
};

app.get('/api/members', async (req, res) => {
    try {
        const members = await Member.find({ 
            discordUserId: { $nin: IGNORED_MEMBER_IDS_API } 
        }).lean();
        
        // Ordenação customizada pela hierarquia
        members.sort((a, b) => {
            const levelA = getRoleLevel(a);
            const levelB = getRoleLevel(b);

            if (levelA !== levelB) {
                return levelA - levelB;
            }
            // Se os níveis forem iguais, ordena por nome de usuário
            return a.username.localeCompare(b.username);
        });

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

// ROTA PARA BUSCAR DETALHES DE UM MEMBRO
app.get('/api/members/:discordUserId', async (req, res) => {
    try {
        const { discordUserId } = req.params;
        const member = await Member.findOne({ discordUserId }).lean();
        if (!member) {
            return res.status(404).json({ success: false, message: 'Membro não encontrado.' });
        }
        // Ordena as observações da mais recente para a mais antiga
        if (member.observations) {
            member.observations.sort((a, b) => new Date(b.date) - new Date(a.date));
        }
        res.json({ success: true, member });
    } catch (error) {
        console.error("Erro ao buscar membro:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar membro.' });
    }
});

// ROTA PARA ADICIONAR UMA OBSERVAÇÃO
app.post('/api/members/:discordUserId/observations', async (req, res) => {
    try {
        const { discordUserId } = req.params;
        const { text, author } = req.body;

        if (!text || !author) {
            return res.status(400).json({ success: false, message: 'O texto da observação e o autor são obrigatórios.' });
        }

        const observation = { text, author, date: new Date() };

        const result = await Member.updateOne(
            { discordUserId: discordUserId },
            { $push: { observations: observation } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ success: false, message: "Membro não encontrado ou falha ao salvar." });
        }

        res.json({ success: true, message: "Observação adicionada com sucesso!", observation });
    } catch (error) {
        console.error("Erro ao adicionar observação:", error);
        res.status(500).json({ success: false, message: 'Erro interno ao adicionar observação.' });
    }
});

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

// ROTA PARA BUSCAR ESTATÍSTICAS DE DESEMPENHO DE UM MEMBRO
app.get('/api/members/:discordUserId/stats', async (req, res) => {
    try {
        const { discordUserId } = req.params;
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const ninetyDaysAgo = new Date(new Date().setDate(now.getDate() - 90));

        // Busca todos os pontos do usuário nos últimos 90 dias
        const userPontos = await Registro.aggregate([
            { $match: { userId: discordUserId } },
            { $unwind: '$pontos' },
            { $match: { 'pontos.saida': { $ne: null }, 'pontos.entrada': { $gte: ninetyDaysAgo } } },
            { $project: { entrada: '$pontos.entrada', saida: '$pontos.saida' } }
        ]);

        if (userPontos.length === 0) {
            return res.json({
                success: true,
                stats: {
                    averageDuration: 0,
                    totalHoursThisMonth: 0,
                    teamAverageHoursThisMonth: 0,
                    activityHeatmap: Array(7).fill(Array(24).fill(0))
                }
            });
        }

        let totalDurationMs = 0;
        let totalHoursThisMonthMs = 0;
        
        // Inicializa o heatmap [diaDaSemana][hora]
        const activityHeatmap = Array.from({ length: 7 }, () => Array(24).fill(0));

        userPontos.forEach(ponto => {
            const duration = ponto.saida.getTime() - ponto.entrada.getTime();
            totalDurationMs += duration;

            if (ponto.entrada >= firstDayOfMonth) {
                totalHoursThisMonthMs += duration;
            }

            // Popula o heatmap
            const entryDate = new Date(ponto.entrada);
            const dayOfWeek = entryDate.getDay(); // Domingo = 0, Sábado = 6
            const hour = entryDate.getHours();
            activityHeatmap[dayOfWeek][hour]++;
        });

        // Calcula a média de todos os usuários no mês atual para comparação
        const teamTotalHoursResult = await Registro.aggregate([
            { $unwind: '$pontos' },
            { $match: { 'pontos.saida': { $ne: null }, 'pontos.entrada': { $gte: firstDayOfMonth } } },
            { $group: {
                _id: null,
                totalDuration: { $sum: { $subtract: ['$pontos.saida', '$pontos.entrada'] } },
                uniqueUsers: { $addToSet: '$userId' }
            }}
        ]);
        
        let teamAverageHoursThisMonth = 0;
        if (teamTotalHoursResult.length > 0) {
            const { totalDuration, uniqueUsers } = teamTotalHoursResult[0];
            const totalTeamUsers = uniqueUsers.length;
            if(totalTeamUsers > 0) {
               teamAverageHoursThisMonth = (totalDuration / totalTeamUsers) / 3600000;
            }
        }
        
        const stats = {
            averageDuration: userPontos.length > 0 ? (totalDurationMs / userPontos.length) : 0,
            totalHoursThisMonth: totalHoursThisMonthMs / 3600000,
            teamAverageHoursThisMonth,
            activityHeatmap
        };

        res.json({ success: true, stats });
    } catch (error) {
        console.error("Erro ao gerar estatísticas do membro:", error);
        res.status(500).json({ success: false, message: 'Erro ao gerar estatísticas.' });
    }
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