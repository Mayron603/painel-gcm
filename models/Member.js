// painel-gcm/models/Member.js

const mongoose = require('mongoose');

// Schema para um cargo individual do Discord
const roleSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, default: '#99aab5' }
}, { _id: false });

// Schema para um membro do Discord
const memberSchema = new mongoose.Schema({
    discordUserId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    username: {
        type: String,
        required: true
    },
    avatarUrl: {
        type: String
    },
    roles: [roleSchema]
}, { timestamps: true });

module.exports = mongoose.model('Member', memberSchema);