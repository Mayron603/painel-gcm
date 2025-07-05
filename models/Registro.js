const mongoose = require('mongoose');

const registroSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true,
        index: true
    },
    username: { 
        type: String, 
        required: true 
    },
    // Novo campo para rastrear o aviso
    ultimoAvisoEnviado: {
        type: Date,
        default: null
    },
    pontos: [
        {
            entrada: { 
                type: Date, 
                required: true 
            },
            saida: { 
                type: Date 
            }
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('Registro', registroSchema);