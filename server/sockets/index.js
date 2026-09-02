'use strict';

const connectionSocket = require('./connection.socket');
const deviceSocket = require('./device.socket');
const screenSocket = require('./screen.socket');
const gallerySocket = require('./gallery.socket');
const controlSocket = require('./control.socket');
const cameraSocket = require('./camera.socket');
const chatSocket = require('./chat.socket');

function registerAll(io) {
    io.on('connection', (socket) => {
        console.log(`New Connection ID: ${socket.id}`);
        connectionSocket(io, socket);
        deviceSocket(io, socket);
        screenSocket(io, socket);
        gallerySocket(io, socket);
        controlSocket(io, socket);
        cameraSocket(io, socket);
        chatSocket(io, socket);
    });
}

module.exports = { registerAll };
