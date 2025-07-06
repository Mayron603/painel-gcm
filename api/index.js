// ROTA DE TESTE DE BANCO DE DADOS
app.get('/api/db-test', async (req, res) => {
  try {
    // Tenta executar um comando simples no banco de dados para verificar a conexão
    await mongoose.connection.db.admin().ping();
    res.status(200).json({ 
        success: true, 
        message: 'Conexão com o MongoDB está funcionando perfeitamente!' 
    });
  } catch (error) {
    console.error("ERRO NO TESTE DE CONEXÃO:", error);
    res.status(500).json({ 
      success: false, 
      message: 'FALHA: A API não conseguiu se conectar ao MongoDB.',
      // Enviamos a mensagem de erro para nos ajudar a depurar
      error: error.message 
    });
  }
});