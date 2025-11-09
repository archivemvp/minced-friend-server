const WebSocket = require('ws');
const port = process.env.PORT || 10000;

const wss = new WebSocket.Server({ port });

// Хранилище
const clients = new Map(); // username -> ws
const friends = new Map(); // username -> [friend1, friend2, ...]
const parties = new Map(); // leader -> [member1, member2, ...]

console.log(`🚀 WebSocket server running on port ${port}`);

wss.on('connection', (ws) => {
    let username = null;
    
    ws.on('message', (data) => {
        const message = data.toString();
        const parts = message.split('|');
        
        // ===== ИДЕНТИФИКАЦИЯ =====
        if (parts[0] === 'IDENTIFY') {
            username = parts[1];
            clients.set(username, ws);
            console.log(`✅ ${username} connected`);
            
            // Отправляем онлайн статус друзьям
            const userFriends = friends.get(username) || [];
            userFriends.forEach(friendName => {
                const friendWs = clients.get(friendName);
                if (friendWs) {
                    friendWs.send(`FRIEND_STATUS|${username}|online|`);
                }
            });
        }
        
        // ===== ДРУЗЬЯ =====
        else if (parts[0] === 'FRIEND_REQUEST') {
            const sender = parts[1];
            const target = parts[2];
            const targetWs = clients.get(target);
            if (targetWs) {
                targetWs.send(`FRIEND_REQUEST|${sender}`);
            }
        }
        
        else if (parts[0] === 'FRIEND_ACCEPT') {
            const sender = parts[1];
            const target = parts[2];
            const uuid = parts[3] || '00000000-0000-0000-0000-000000000000';
            
            if (!friends.has(sender)) friends.set(sender, []);
            if (!friends.has(target)) friends.set(target, []);
            
            friends.get(sender).push(target);
            friends.get(target).push(sender);
            
            const targetWs = clients.get(target);
            const senderWs = clients.get(sender);
            
            if (targetWs) targetWs.send(`FRIEND_ACCEPT|${sender}|${uuid}|online|`);
            if (senderWs) senderWs.send(`FRIEND_ACCEPT|${target}|${uuid}|online|`);
        }
        
        else if (parts[0] === 'FRIEND_MESSAGE') {
            const sender = parts[1];
            const target = parts[2];
            const content = parts[3] || '';
            
            const targetWs = clients.get(target);
            if (targetWs) {
                targetWs.send(`FRIEND_MESSAGE|${sender}|${content}`);
            }
        }
        
        else if (parts[0] === 'FRIEND_COORDS') {
            const sender = parts[1];
            const target = parts[2];
            const x = parts[3] || '0';
            const y = parts[4] || '0';
            const z = parts[5] || '0';
            
            const targetWs = clients.get(target);
            if (targetWs) {
                const coordMsg = `Координаты от ${sender}: X=${x}, Y=${y}, Z=${z}`;
                targetWs.send(`FRIEND_MESSAGE|${sender}|${coordMsg}`);
            }
        }
        
        // ===== PARTY СИСТЕМА =====
        else if (parts[0] === 'PARTY_CREATE') {
            const leader = parts[1];
            parties.set(leader, [leader]);
        }
        
        else if (parts[0] === 'PARTY_INVITE') {
            const leader = parts[1];
            const target = parts[2];
            
            const targetWs = clients.get(target);
            if (targetWs) {
                targetWs.send(`PARTY_INVITE|${leader}`);
            }
        }
        
        else if (parts[0] === 'PARTY_ACCEPT') {
            const member = parts[1];
            const leader = parts[2];
            
            const party = parties.get(leader);
            if (party) {
                party.push(member);
                
                const leaderWs = clients.get(leader);
                if (leaderWs) {
                    leaderWs.send(`PARTY_ACCEPT|${member}`);
                }
                
                party.forEach(partyMember => {
                    if (partyMember !== member) {
                        const memberWs = clients.get(partyMember);
                        if (memberWs) {
                            memberWs.send(`PARTY_MEMBER_JOIN|${member}`);
                        }
                    }
                });
            }
        }
        
        else if (parts[0] === 'PARTY_DECLINE') {
            const member = parts[1];
            const leader = parts[2];
            
            const leaderWs = clients.get(leader);
            if (leaderWs) {
                leaderWs.send(`PARTY_DECLINE|${member}`);
            }
        }
        
        else if (parts[0] === 'PARTY_LEAVE') {
            const member = parts[1];
            
            for (const [leader, members] of parties.entries()) {
                const index = members.indexOf(member);
                if (index !== -1) {
                    members.splice(index, 1);
                    
                    if (member === leader) {
                        members.forEach(partyMember => {
                            const memberWs = clients.get(partyMember);
                            if (memberWs) {
                                memberWs.send(`PARTY_DISBAND|${leader}`);
                            }
                        });
                        parties.delete(leader);
                    } else {
                        members.forEach(partyMember => {
                            const memberWs = clients.get(partyMember);
                            if (memberWs) {
                                memberWs.send(`PARTY_LEAVE|${member}`);
                            }
                        });
                    }
                    break;
                }
            }
        }
        
        else if (parts[0] === 'PARTY_TRANSFER_LEADER') {
            const oldLeader = parts[1];
            const newLeader = parts[2];
            
            const party = parties.get(oldLeader);
            if (party && party.includes(newLeader)) {
                // Transfer party ownership
                parties.set(newLeader, party);
                parties.delete(oldLeader);
                
                // Notify all members
                party.forEach(member => {
                    const memberWs = clients.get(member);
                    if (memberWs) {
                        memberWs.send(`PARTY_TRANSFER_LEADER|${newLeader}`);
                    }
                });
            }
        }
        
        else if (parts[0] === 'PARTY_KICK') {
            const leader = parts[1];
            const kickedMember = parts[2];
            
            const party = parties.get(leader);
            if (party) {
                const index = party.indexOf(kickedMember);
                if (index !== -1) {
                    party.splice(index, 1);
                    
                    // Notify kicked member
                    const kickedWs = clients.get(kickedMember);
                    if (kickedWs) {
                        kickedWs.send(`PARTY_KICK|${kickedMember}`);
                    }
                    
                    // Notify other members
                    party.forEach(member => {
                        if (member !== kickedMember) {
                            const memberWs = clients.get(member);
                            if (memberWs) {
                                memberWs.send(`PARTY_KICK|${kickedMember}`);
                            }
                        }
                    });
                }
            }
        }
        
        else if (parts[0] === 'PARTY_WAYPOINT') {
            const sender = parts[1];
            const x = parts[2] || '0';
            const y = parts[3] || '0';
            const z = parts[4] || '0';
            
            for (const [leader, members] of parties.entries()) {
                if (members.includes(sender)) {
                    members.forEach(member => {
                        if (member !== sender) {
                            const memberWs = clients.get(member);
                            if (memberWs) {
                                memberWs.send(`PARTY_WAYPOINT|${x}|${y}|${z}`);
                            }
                        }
                    });
                    break;
                }
            }
        }
        
        else if (parts[0] === 'PARTY_PLAYER_MARKER') {
            const sender = parts[1];
            const targetPlayer = parts[2] || '';
            const duration = parts[3] || '10000';
            
            for (const [leader, members] of parties.entries()) {
                if (members.includes(sender)) {
                    members.forEach(member => {
                        if (member !== sender) {
                            const memberWs = clients.get(member);
                            if (memberWs) {
                                memberWs.send(`PARTY_PLAYER_MARKER|${targetPlayer}|${duration}`);
                            }
                        }
                    });
                    break;
                }
            }
        }
        
        // ===== IRC ЧАТ =====
        else {
            clients.forEach((clientWs, clientName) => {
                if (clientWs !== ws) {
                    clientWs.send(message);
                }
            });
        }
    });
    
    ws.on('close', () => {
        if (username) {
            clients.delete(username);
            console.log(`👋 ${username} disconnected`);
            
            const userFriends = friends.get(username) || [];
            userFriends.forEach(friendName => {
                const friendWs = clients.get(friendName);
                if (friendWs) {
                    friendWs.send(`FRIEND_STATUS|${username}|offline|`);
                }
            });
        }
    });
});
