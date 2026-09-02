'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/chat.controller');

module.exports = function () {
    router.get('/chats', ctrl.getChats);
    router.get('/chat_contacts', ctrl.getChatContacts);
    return router;
};
