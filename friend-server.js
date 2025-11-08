// Simple WebSocket server for friend requests
// Run: node friend-server.js
// Port: process.env.PORT || 10000 (for hosting)

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const PORT = process.env.PORT || 10000;

// Создаем HTTP сервер для Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Minced Friend Server is running');
});

const wss = new WebSocket.Server({ server, path: '/ws' });

server.listen(PORT, () => {
    console.log(`[Friend Server] HTTP server listening on port ${PORT}`);
});

const clients = new Map(); // username -> WebSocket
const friendRequests = new Map(); // targetUsername -> [senderUsername, ...]
const friends = new Map(); // username -> [friendUsername, ...]

const DATA_FILE = 'friend-data.json';

// Загрузка данных из файла
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            
            // Загружаем заявки
            if (data.friendRequests) {
                Object.entries(data.friendRequests).forEach(([target, senders]) => {
                    friendRequests.set(target, senders);
                });
            }
            
            // Загружаем друзей
            if (data.friends) {
                Object.entries(data.friends).forEach(([username, friendList]) => {
                    friends.set(username, friendList);
                });
            }
            
            console.log('[Friend Server] Loaded data from file');
            console.log(`[Friend Server] Pending requests: ${friendRequests.size} users`);
        }
    } catch (error) {
        console.error('[Friend Server] Error loading data:', error.message);
    }
}

// Сохранение данных в файл
function saveData() {
    try {
        const data = {
            friendRequests: Object.fromEntries(friendRequests),
            friends: Object.fromEntries(friends)
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[Friend Server] Error saving data:', error.message);
    }
}

// Загружаем данные при старте
loadData();

console.log('[Friend Server] Started on port 10000');

wss.on('connection', (ws) => {
    let username = null;
    let requestsSent = false;
    
    console.log('[Friend Server] Client connected');
    
    ws.on('message', (data) => {
        const message = data.toString();
        const parts = message.split('|');
        const type = parts[0];
        
        // IDENTIFY packet: IDENTIFY|username
        if (type === 'IDENTIFY' && parts.length >= 2) {
            username = parts[1];
            clients.set(username, ws);
            console.log(`[Friend Server] ${username} identified`);
            
            // Отправляем все ожидающие заявки сразу после идентификации
            if (!requestsSent) {
                requestsSent = true;
                sendPendingRequests(username, ws);
            }
            return;
        }
        
        // IRC messages (username|message)
        if (!type.startsWith('FRIEND_') && !type.startsWith('IDENTIFY') && parts.length >= 2) {
            if (!username) {
                username = parts[0];
                clients.set(username, ws);
                
                // Отправляем все ожидающие заявки при первом подключении
                if (!requestsSent) {
                    requestsSent = true;
                    sendPendingRequests(username, ws);
                }
            }
            
            // Broadcast IRC message
            const ircMsg = parts.slice(1).join('|');
            broadcast(message);
            return;
        }
        
        // Friend request: FRIEND_REQUEST|sender|target
        if (type === 'FRIEND_REQUEST' && parts.length >= 3) {
            const sender = parts[1];
            const target = parts[2];
            
            console.log(`[Friend Server] ${sender} -> ${target} (friend request)`);
            
            // Store request
            if (!friendRequests.has(target)) {
                friendRequests.set(target, []);
            }
            if (!friendRequests.get(target).includes(sender)) {
                friendRequests.get(target).push(sender);
                saveData(); // Сохраняем после добавления заявки
            }
            
            // Send to target if online
            const targetWs = clients.get(target);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(`FRIEND_REQUEST|${sender}`);
                console.log(`[Friend Server] Sent request notification to ${target}`);
            } else {
                console.log(`[Friend Server] ${target} is offline, request saved`);
            }
        }
        
        // Friend accept: FRIEND_ACCEPT|accepter|sender|uuid
        else if (type === 'FRIEND_ACCEPT' && parts.length >= 4) {
            const accepter = parts[1];
            const sender = parts[2];
            const uuid = parts[3];
            
            console.log(`[Friend Server] ${accepter} accepted ${sender}`);
            
            // Remove from requests
            if (friendRequests.has(accepter)) {
                const requests = friendRequests.get(accepter);
                const index = requests.indexOf(sender);
                if (index > -1) {
                    requests.splice(index, 1);
                }
            }
            
            // Add to friends
            if (!friends.has(accepter)) {
                friends.set(accepter, []);
            }
            if (!friends.has(sender)) {
                friends.set(sender, []);
            }
            friends.get(accepter).push(sender);
            friends.get(sender).push(accepter);
            
            // Сохраняем изменения
            saveData();
            
            // Notify both users
            const senderWs = clients.get(sender);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                senderWs.send(`FRIEND_ACCEPT|${accepter}|${uuid}|online|`);
            }
            
            // Send back to accepter
            ws.send(`FRIEND_ACCEPT|${sender}|${uuid}|online|`);
        }
        
        // Friend decline: FRIEND_DECLINE|decliner|sender
        else if (type === 'FRIEND_DECLINE' && parts.length >= 3) {
            const decliner = parts[1];
            const sender = parts[2];
            
            console.log(`[Friend Server] ${decliner} declined ${sender}`);
            
            // Remove from requests
            if (friendRequests.has(decliner)) {
                const requests = friendRequests.get(decliner);
                const index = requests.indexOf(sender);
                if (index > -1) {
                    requests.splice(index, 1);
                }
            }
            
            // Сохраняем изменения
            saveData();
        }
        
        // Friend message: FRIEND_MESSAGE|sender|target|message
        else if (type === 'FRIEND_MESSAGE' && parts.length >= 4) {
            const sender = parts[1];
            const target = parts[2];
            const msgContent = parts.slice(3).join('|');
            
            const targetWs = clients.get(target);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(`FRIEND_MESSAGE|${sender}|${msgContent}`);
                console.log(`[Friend Server] Message ${sender} -> ${target}: ${msgContent}`);
            }
        }
        
        // Coordinates: FRIEND_COORDS|sender|target|x|y|z
        else if (type === 'FRIEND_COORDS' && parts.length >= 6) {
            const sender = parts[1];
            const target = parts[2];
            const x = parts[3];
            const y = parts[4];
            const z = parts[5];
            
            const targetWs = clients.get(target);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                // Send as regular message with coordinates
                targetWs.send(`FRIEND_MESSAGE|${sender}|Coordinates: ${x}, ${y}, ${z}`);
                console.log(`[Friend Server] Coords ${sender} -> ${target}: ${x}, ${y}, ${z}`);
            }
        }
    });
    
    ws.on('close', () => {
        if (username) {
            console.log(`[Friend Server] ${username} disconnected`);
            clients.delete(username);
        }
    });
    
    ws.on('error', (error) => {
        console.error('[Friend Server] Error:', error.message);
    });
});

function sendPendingRequests(username, ws) {
    // Отправляем все ожидающие заявки этому игроку
    console.log(`[Friend Server] Checking pending requests for ${username}...`);
    console.log(`[Friend Server] Total pending users: ${friendRequests.size}`);
    
    if (friendRequests.has(username)) {
        const requests = friendRequests.get(username);
        console.log(`[Friend Server] Sending ${requests.length} pending requests to ${username}`);
        requests.forEach(sender => {
            const packet = `FRIEND_REQUEST|${sender}`;
            console.log(`[Friend Server] -> ${packet}`);
            ws.send(packet);
        });
    } else {
        console.log(`[Friend Server] No pending requests for ${username}`);
    }
}

function broadcast(message) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}
