'use strict';

function cameraSocket(io, socket) {
    // WebRTC signaling for camera (and legacy callers)
    socket.on('offer', (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            console.log(`Offer Received -> Relaying to: ${targetRoom}`);
            socket.to(targetRoom).emit('offer', data);
        }
    });

    socket.on('answer', (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            console.log(`Answer Received -> Relaying to: ${targetRoom}`);
            socket.to(targetRoom).emit('answer', data);
        }
    });

    socket.on('candidate', (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            socket.to(targetRoom).emit('candidate', data);
        }
    });

    // Switch camera command
    socket.on('switch-camera', (data) => {
        if (data && data.target) {
            console.log(`Switch Camera Command -> ${data.target}`);
            io.to(data.target).emit('switch-camera');
        }
    });
}

module.exports = cameraSocket;
