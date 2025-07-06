const mongoose = require('mongoose');

let isConnected = false; // Para evitar múltiplas conexões em ambientes serverless

async function connectMongo() {
  if (!isConnected) {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      isConnected = true;
      console.log("✅ MongoDB conectado com sucesso.");
    } catch (err) {
      console.error("❌ Erro ao conectar ao MongoDB:", err);
      throw err;
    }
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).end(); // Method Not Allowed
  }

  try {
    await connectMongo();
    await mongoose.connection.db.admin().ping();
    return res.status(200).json({ success: true, message: 'Conexão com MongoDB OK!' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao conectar com o MongoDB',
      error: error.message,
    });
  }
};
