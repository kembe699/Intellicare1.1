// Simple TCP-to-WebSocket bridge for Mindray BC-10 communication
// Run this with Node.js: node tcp-bridge.js

import { WebSocketServer } from 'ws';
import net from 'net';

const WS_PORT = 9090; // WebSocket server port - different from BC-10 port
const TCP_HOST = '192.168.11.191'; // Your BC-10 IP address
const TCP_PORT = 5100; // BC-10 TCP port

console.log('Starting TCP-to-WebSocket bridge for Mindray BC-10...');
console.log(`WebSocket server: ws://localhost:${WS_PORT}`);
console.log(`TCP target: ${TCP_HOST}:${TCP_PORT}`);

// Create WebSocket server
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('Browser connected to WebSocket bridge');
  
  // Create TCP connection to BC-10
  const tcpClient = new net.Socket();
  
  // Connect to BC-10 device
  tcpClient.connect(TCP_PORT, TCP_HOST, () => {
    console.log(`Connected to BC-10 at ${TCP_HOST}:${TCP_PORT}`);
  });
  
  // Forward WebSocket messages to TCP
  ws.on('message', (data) => {
    console.log('Forwarding HL7 message to BC-10:', data.toString());
    tcpClient.write(data);
  });
  
  // Forward TCP responses to WebSocket
  tcpClient.on('data', (data) => {
    console.log('Received HL7 response from BC-10:', data.toString());
    ws.send(data);
  });
  
  // Handle disconnections
  ws.on('close', () => {
    console.log('Browser disconnected');
    tcpClient.destroy();
  });
  
  tcpClient.on('close', () => {
    console.log('BC-10 connection closed');
    ws.close();
  });
  
  tcpClient.on('error', (err) => {
    console.error('BC-10 connection error:', err.message);
    ws.close();
  });
});

console.log(`TCP-to-WebSocket bridge running on port ${WS_PORT}`);
console.log('Configure your browser to connect to ws://localhost:6100');
